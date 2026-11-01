import { test } from "node:test";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConsole } from "../server.js";

async function setup(t, delay = 15) {
  const dir = await mkdtemp(join(tmpdir(), "devos-console-test-"));
  const app = createConsole({ dataDir: dir, stepDelayMs: delay });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const session = await fetch(base + "/api/session").then((r) => r.json());
  const request = async (path, body, headers = {}) => {
    const r = await fetch(base + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Devos-Token": session.token,
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, data: await r.json() };
  };
  const create = async () =>
    (
      await request("/tasks", {
        title: "控制台测试任务",
        description: "演练固定样例",
        projectId: "zhichuang",
      })
    ).data;
  return { app, base, request, create, dir };
}
async function queued(f) {
  let task = await f.create();
  for (let i = 0; i < 3; i++) {
    const r = await f.request(`/tasks/${task.id}/approve`, {
      version: task.version,
    });
    assert.equal(r.status, 200);
    task = r.data;
  }
  assert.equal(task.status, "queued");
  return task;
}
async function waitFor(f, id, predicate) {
  for (let i = 0; i < 200; i++) {
    const task = (await f.request("/tasks/" + id)).data;
    if (predicate(task)) return task;
    await new Promise((r) => setTimeout(r, 15));
  }
  assert.fail("task did not reach expected state");
}

test("local session rejects foreign origins, unknown hosts, bad tokens and injected execution fields", async (t) => {
  const f = await setup(t);
  assert.equal(
    (
      await f.request("/tasks", undefined, {
        Origin: "https://untrusted.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.request("/tasks", undefined, { "X-Devos-Token": "invalid" }))
      .status,
    403,
  );
  const hostileStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(
      f.base + "/api/session",
      { headers: { Host: "untrusted.example" } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(hostileStatus, 403);
  assert.equal(
    (
      await f.request("/tasks", {
        title: "x",
        description: "x",
        projectId: "zhichuang",
        command: "arbitrary",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.request("/tasks", {
        title: "x",
        description: "x",
        projectId: "other",
      })
    ).status,
    400,
  );
  assert.deepEqual((await f.request("/tasks")).data, []);
});

test("approval gates, optimistic versions and artifact editing preserve the real state machine", async (t) => {
  const f = await setup(t);
  let task = await f.create();
  assert.equal(
    (await f.request(`/tasks/${task.id}/run`, { version: task.version }))
      .status,
    409,
  );
  assert.equal(
    (await f.request(`/tasks/${task.id}/approve`, { version: -1 })).status,
    409,
  );
  let r = await f.request(`/tasks/${task.id}/artifact`, {
    version: task.version,
    kind: "intent",
    content: "经过人工编辑的需求",
  });
  assert.equal(r.status, 200);
  task = r.data;
  assert.equal(task.artifacts.intent.content, "经过人工编辑的需求");
  r = await f.request(`/tasks/${task.id}/approve`, { version: task.version });
  assert.equal(r.data.status, "spec_review");
  assert.equal(r.data.approvals.intent.actor, "local-console");
  assert.equal(r.data.approvals.intent.hash, task.artifacts.intent.hash);
});

test("mock execution runs real Node assertions, repairs once, and survives reopening the database", async (t) => {
  const f = await setup(t);
  let task = await queued(f);
  assert.equal(
    (await f.request(`/tasks/${task.id}/run`, { version: task.version }))
      .status,
    200,
  );
  task = await waitFor(
    f,
    task.id,
    (t) => !t.active && t.status === "completed",
  );
  assert.equal(task.repairs, 1);
  assert.equal(task.verification, "passed");
  const report = (await f.request(`/tasks/${task.id}/report`)).data;
  assert.equal(report.acceptance, "needs_human_review");
  assert.equal(report.modelUsage.totalTokens, 0);
  assert.deepEqual(
    report.tools
      .filter((t) => t.record.tool === "command")
      .map((t) => t.record.exitCode),
    [1, 0],
  );
  const second = createConsole({ dataDir: f.dir });
  try {
    assert.equal(second.store.get(task.id).status, "completed");
    assert.equal(second.store.readReport(report.id).id, report.id);
  } finally {
    second.store.close();
  }
});

test("duplicate starts are rejected and cancellation persists without passing verification", async (t) => {
  const f = await setup(t, 150);
  let task = await queued(f);
  await f.request(`/tasks/${task.id}/run`, { version: task.version });
  task = (await f.request("/tasks/" + task.id)).data;
  assert.equal(
    (await f.request(`/tasks/${task.id}/run`, { version: task.version }))
      .status,
    409,
  );
  assert.equal(
    (await f.request(`/tasks/${task.id}/cancel`, { version: 0 })).status,
    200,
  );
  task = await waitFor(
    f,
    task.id,
    (t) => !t.active && t.status === "cancelled",
  );
  assert.equal(task.verification, "not_run");
  const report = (await f.request(`/tasks/${task.id}/report`)).data;
  assert.equal(report.checks[0].verdict, "not_run");
});

test("an interrupted pending checkpoint requires explicit reconciliation before retry", async (t) => {
  const f = await setup(t);
  let task = await queued(f);
  task = f.app.store.transition(task.id, task.version, "running");
  task = f.app.store.checkpoint(task.id, task.version, {
    operation: "pending",
    operationKey: `${task.id}:0`,
    deadline: Date.now() + 60000,
  });
  await f.request(`/tasks/${task.id}/run`, { version: task.version });
  task = await waitFor(f, task.id, (t) => !t.active && t.status === "paused");
  assert.equal(
    (
      await f.request(`/tasks/${task.id}/resolve`, {
        version: task.version,
        decision: "not_executed",
        evidence: "",
      })
    ).status,
    400,
  );
  task = (
    await f.request(`/tasks/${task.id}/resolve`, {
      version: task.version,
      decision: "not_executed",
      evidence: "已检查样例工作区，确认没有产生写入",
    })
  ).data;
  assert.equal(task.status, "queued");
  await f.request(`/tasks/${task.id}/run`, { version: task.version });
  task = await waitFor(
    f,
    task.id,
    (t) => !t.active && t.status === "completed",
  );
  assert.equal(task.repairs, 1);
});
