import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import {
  mkdirSync,
  chmodSync,
  existsSync,
  readFileSync,
  statSync,
} from "node:fs";
import { resolve, join, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { TaskStore, runTask } from "../../packages/agent-core/index.js";
import { WorkspaceTools } from "../../packages/tool-kit/index.js";

export const projects = [
  {
    id: "zhichuang",
    name: "智创码坊官网",
    repository: "neokill01/zhichuangmafang",
    stack: "HTML · CSS · JavaScript",
  },
  {
    id: "devos",
    name: "Agentic DevOS",
    repository: "neokill01/ai-native-sdlc",
    stack: "React · Vite · Node.js",
  },
];
const activeStates = ["running", "verifying", "repairing"];
const reviewKind = {
  intent_review: "intent",
  spec_review: "spec",
  plan_review: "plan",
};
const publicDir = resolve(
  fileURLToPath(new URL("../console/dist/", import.meta.url)),
);
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const keys = (body, allowed) => {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((k) => !allowed.includes(k))
  )
    throw fail("请求字段不合法");
};

export function createConsole({
  dataDir = resolve(
    process.env.DEVOS_DATA_DIR ||
      fileURLToPath(new URL("../../.devos/console/", import.meta.url)),
  ),
  stepDelayMs = 800,
} = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const store = new TaskStore(join(dataDir, "tasks.sqlite"));
  chmodSync(join(dataDir, "tasks.sqlite"), 0o600);
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS console_meta(task_id TEXT PRIMARY KEY REFERENCES tasks(id),project_id TEXT NOT NULL,created_at TEXT NOT NULL)",
  );
  const token = randomBytes(32).toString("hex");
  const jobs = new Map();
  const meta = (id) =>
    store.db
      .prepare("SELECT project_id,created_at FROM console_meta WHERE task_id=?")
      .get(id);
  function taskView(id) {
    const m = meta(id);
    if (!m) throw fail("任务不存在", 404);
    return {
      ...store.get(id),
      projectId: m.project_id,
      createdAt: m.created_at,
      active: jobs.has(id),
      mode: "mock",
      workspaceKind: "fixture",
    };
  }
  function requireVersion(body, task) {
    if (!Number.isSafeInteger(body.version) || body.version !== task.version)
      throw fail("任务已更新，请刷新后操作", 409);
  }
  async function fixtureTools(id, lease) {
    const root = join(dataDir, "workspaces", id);
    await import("node:fs/promises").then((fs) =>
      fs.mkdir(root, { recursive: true, mode: 0o700 }),
    );
    return WorkspaceTools.create({
      root,
      writable: ["src/add.mjs"],
      trustedLocal: true,
      authorizeWrite: () => store.get(id).status === "running",
      assertLease: () => store.assertLease(id, lease),
      onRecord: (record) =>
        store.recordTool(id, store.get(id).repairs, record, lease),
      commands: {
        "fixture-unit": {
          executable: process.execPath,
          args: [
            "--input-type=module",
            "-e",
            "import assert from 'node:assert/strict'; import { add } from './src/add.mjs'; assert.equal(add(2,3),5); assert.equal(add(-1,1),0);",
          ],
        },
      },
    });
  }
  function launch(id) {
    if (jobs.has(id)) throw fail("任务正在执行", 409);
    const controller = new AbortController();
    const job = { controller, promise: null };
    jobs.set(id, job);
    job.promise = Promise.resolve()
      .then(() =>
        runTask(store, id, {
          workerId: `console-${process.pid}`,
          timeoutMs: 120_000,
          signal: controller.signal,
          runtime: {
            execute: async ({ task, lease, signal }) => {
              await delay(stepDelayMs, null, { signal });
              const tools = await fixtureTools(id, lease);
              signal.throwIfAborted();
              await tools.write(
                "src/add.mjs",
                task.repairs === 0
                  ? "export const add = (a,b) => a-b;\n"
                  : "export const add = (a,b) => a+b;\n",
              );
              return {
                summary:
                  "Mock 样例执行：仅写入独立样例目录的 add 函数；未修改业务仓库，未调用模型。",
              };
            },
          },
          evaluator: {
            verify: async ({ lease, signal }) => {
              await delay(stepDelayMs, null, { signal });
              const tools = await fixtureTools(id, lease);
              const result = await tools.command("fixture-unit", { signal });
              return {
                verdict:
                  result.exitCode === 0 && result.reason === null
                    ? "passed"
                    : "failed",
                evidence: JSON.stringify(result),
              };
            },
          },
        }),
      )
      .catch(() => {
        // Fenced/uncertain tasks remain visible for recovery; never fabricate completion.
        store.event(id, "console.execution_stopped", {
          reason: "恢复前请检查任务状态及租约",
        });
      })
      .finally(() => jobs.delete(id));
  }
  async function body(req) {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 64 * 1024) throw fail("请求内容过大", 413);
    }
    try {
      return JSON.parse(raw || "{}");
    } catch {
      throw fail("请求必须为 JSON");
    }
  }
  const json = (res, status, data) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(data));
  };
  const server = createServer(async (req, res) => {
    try {
      const hosts = [
        `127.0.0.1:${req.socket.localPort}`,
        `localhost:${req.socket.localPort}`,
      ];
      if (!hosts.includes(req.headers.host)) throw fail("Host 不受信任", 403);
      const origin = req.headers.origin;
      const origins = [
        ...hosts.map((h) => `http://${h}`),
        "http://127.0.0.1:5174",
        "http://localhost:5174",
      ];
      if (origin && !origins.includes(origin))
        throw fail("Origin 不受信任", 403);
      const path = new URL(req.url, "http://localhost").pathname;
      if (path === "/api/session" && req.method === "GET")
        return json(res, 200, {
          token,
          mode: "mock",
          actor: "local-console",
          projects,
        });
      if (path.startsWith("/api/")) {
        if (req.headers["x-devos-token"] !== token)
          throw fail("会话无效，请刷新页面", 403);
        if (req.method === "GET" && path === "/api/tasks") {
          const rows = store.db
            .prepare(
              "SELECT task_id FROM console_meta ORDER BY created_at DESC",
            )
            .all();
          return json(
            res,
            200,
            rows.map((row) => taskView(row.task_id)),
          );
        }
        if (req.method === "POST" && path === "/api/tasks") {
          const b = await body(req);
          keys(b, ["title", "description", "projectId"]);
          if (
            typeof b.title !== "string" ||
            !b.title.trim() ||
            b.title.length > 120 ||
            typeof b.description !== "string" ||
            b.description.length > 8000 ||
            !projects.some((p) => p.id === b.projectId)
          )
            throw fail("请填写有效的项目、标题与需求描述");
          let task = store.create(b.title.trim(), { maxRepairs: 2 });
          store.db
            .prepare("INSERT INTO console_meta VALUES(?,?,?)")
            .run(task.id, b.projectId, new Date().toISOString());
          task = store.artifact(
            task.id,
            task.version,
            "intent",
            `${b.title.trim()}\n\n${b.description || "请在审批前补充范围与验收标准。"}\n\n本轮为 mock 流程演练，不修改业务仓库。`,
          );
          task = store.transition(task.id, task.version, "intent_review");
          return json(res, 201, taskView(task.id));
        }
        const match = path.match(
          /^\/api\/tasks\/([a-f0-9-]{36})(?:\/(events|report|approve|artifact|run|cancel|resolve))?$/,
        );
        if (!match) throw fail("接口不存在", 404);
        const [, id, action] = match;
        let task = taskView(id);
        if (req.method === "GET") {
          if (!action) return json(res, 200, task);
          if (action === "events") return json(res, 200, store.events(id));
          if (action === "report") return json(res, 200, store.report(id));
        }
        if (req.method !== "POST") throw fail("接口不存在", 404);
        const b = await body(req);
        const allowed = {
          approve: ["version"],
          artifact: ["version", "kind", "content"],
          run: ["version"],
          cancel: ["version"],
          resolve: ["version", "decision", "evidence"],
        };
        if (!allowed[action]) throw fail("接口不存在", 404);
        keys(b, allowed[action]);
        // Cancelling a live job only signals that job; it never overwrites a task snapshot.
        // Accept an older UI version here so progress updates cannot make cancellation unusable.
        if (action === "cancel" && jobs.has(id)) {
          if (!Number.isSafeInteger(b.version) || b.version < 0)
            throw fail("任务版本无效");
        } else requireVersion(b, task);
        if (action === "approve") {
          const kind = reviewKind[task.status];
          if (!kind) throw fail("当前任务不在审批阶段", 409);
          task = store.approve(id, task.version, "local-console");
          const target = {
            intent: "spec_review",
            spec: "plan_review",
            plan: "queued",
          }[kind];
          task = store.transition(id, task.version, target);
          if (kind === "intent")
            task = store.artifact(
              id,
              task.version,
              "spec",
              "Mock 验收：执行独立 add 函数样例；首轮真实断言失败，有限修复后通过。业务需求仅用于流程演练，不代表已实现。",
            );
          if (kind === "spec")
            task = store.artifact(
              id,
              task.version,
              "plan",
              JSON.stringify(
                {
                  mode: "mock",
                  steps: [
                    "独立样例工作区",
                    "写入样例实现",
                    "真实 Node 断言",
                    "有限修复",
                    "保留证据报告",
                  ],
                  businessRepositoryModified: false,
                },
                null,
                2,
              ),
            );
        } else if (action === "artifact") {
          if (
            b.kind !== reviewKind[task.status] ||
            typeof b.content !== "string" ||
            b.content.length > 12_000
          )
            throw fail("产物不可编辑");
          store.artifact(id, task.version, b.kind, b.content);
        } else if (action === "run") {
          if (!["queued", ...activeStates].includes(task.status))
            throw fail("任务尚未批准或不可执行", 409);
          launch(id);
        } else if (action === "cancel") {
          if (jobs.has(id)) jobs.get(id).controller.abort();
          else if (["queued", "paused"].includes(task.status))
            store.transition(id, task.version, "cancelled", "cancelled");
          else throw fail("当前任务无法取消", 409);
        } else if (action === "resolve") {
          if (jobs.has(id)) throw fail("请先停止执行", 409);
          store.resolvePending(id, task.version, {
            actor: "local-console",
            decision: b.decision,
            evidence: b.evidence,
          });
        }
        return json(res, 200, taskView(id));
      }
      if (req.method !== "GET") throw fail("页面不存在", 404);
      const candidate = resolve(publicDir, `.${decodeURIComponent(path)}`);
      if (
        !(candidate === publicDir || candidate.startsWith(publicDir + sep)) ||
        candidate.includes("\0")
      )
        throw fail("页面不存在", 404);
      const file =
        existsSync(candidate) && statSync(candidate).isFile()
          ? candidate
          : extname(path)
            ? null
            : join(publicDir, "index.html");
      if (!file || !existsSync(file))
        throw fail("请先运行 npm run build:console", 404);
      const mime = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      };
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        "Cache-Control": extname(file) === ".html" ? "no-store" : "no-cache",
      });
      res.end(readFileSync(file));
    } catch (error) {
      json(res, error.status || 400, {
        error: error.status
          ? error.message
          : "操作未完成，请刷新任务状态后重试",
      });
    }
  });
  return {
    server,
    store,
    async close() {
      for (const job of jobs.values()) job.controller.abort();
      await Promise.allSettled([...jobs.values()].map((j) => j.promise));
      await new Promise((r) => server.close(r));
      store.close();
    },
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.DEVOS_PORT || 3001);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error("DEVOS_PORT must be an integer between 1024 and 65535");
  }
  const app = createConsole();
  app.server.listen(port, "127.0.0.1", () =>
    console.log(`DevOS console: http://127.0.0.1:${port} (mock, local only)`),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => app.close().then(() => process.exit()));
}
