import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { TaskStore } from '../index.js';
import { runTask } from '../loop.js';
import { WorkspaceTools } from '../../tool-kit/index.js';

const hash = 'a'.repeat(64);
const command = (exitCode = 0) => ({ tool: 'command', command: 'test', exitCode, signal: null, reason: null, durationMs: 1, outputBytes: 0, outputHash: hash });
function setup(t, maxRepairs = 0) {
  const root = mkdtempSync(join(tmpdir(), 'devos-report-'));
  const file = join(root, 'tasks.db');
  let store = new TaskStore(file);
  t.after(() => { store.close(); rmSync(root, { recursive: true }); });
  let task = store.create('Evidence test', { maxRepairs });
  task = store.artifact(task.id, task.version, 'intent', 'test intent');
  task = store.transition(task.id, task.version, 'intent_review');
  for (const [kind, target] of [['intent', 'spec_review'], ['spec', 'plan_review'], ['plan', 'queued']]) {
    if (kind !== 'intent') task = store.artifact(task.id, task.version, kind, kind);
    task = store.approve(task.id, task.version, 'test-reviewer');
    task = store.transition(task.id, task.version, target);
  }
  return { root, file, task, get store() { return store; }, reopen() { store.close(); store = new TaskStore(file); return store; } };
}

test('reports and tool evidence survive reopening; raw output and verdict text are absent', async t => {
  const f = setup(t);
  const { store, task, root } = f;
  const tools = await WorkspaceTools.create({ root, writable: ['src/'], authorizeWrite: () => store.get(task.id).status === 'running', trustedLocal: true,
    onRecord: record => store.recordTool(task.id, 0, record),
    commands: { test: { executable: process.execPath, args: ['-e', 'console.log("fake-sensitive-output")'] } },
  });
  const result = await runTask(store, task.id, {
    runtime: { execute: async () => tools.write('src/a.js', 'export const a = 1;') },
    evaluator: { verify: async () => {
      const proof = await tools.command('test');
      return { verdict: proof.exitCode === 0 ? 'passed' : 'failed', evidence: 'fake-sensitive-evidence' };
    } },
  });
  assert.equal(result.status, 'completed');
  const report = store.report(task.id);
  assert.equal(report.tools.length, 2);
  assert.equal(report.checks[0].verdict, 'passed');
  assert.equal(report.acceptance, 'needs_human_review');
  assert.equal(report.tools[0].operationKey, `${task.id}:0`);
  const reopened = f.reopen();
  assert.deepEqual(reopened.readReport(report.id), report);
  const cli = spawnSync(process.execPath, [new URL('../report-cli.js', import.meta.url).pathname, '--db', f.file, '--report', report.id], { encoding: 'utf8' });
  assert.equal(cli.status, 0);
  assert.deepEqual(JSON.parse(cli.stdout), report);
  assert.deepEqual(reopened.report(task.id), report);
  const bytes = readFileSync(f.file).toString();
  assert.equal(bytes.includes('fake-sensitive-output'), false);
  assert.equal(bytes.includes('fake-sensitive-evidence'), false);
});

test('late cancellation evidence creates new snapshot without mutating old report', t => {
  const { store, task } = setup(t);
  let current = store.transition(task.id, task.version, 'running');
  current = store.transition(task.id, current.version, 'cancelled', 'cancelled');
  const before = store.report(task.id);
  assert.equal(before.checks[0].verdict, 'not_run');
  store.recordTool(task.id, 0, { ...command(null), signal: 'SIGKILL', reason: 'cancelled' });
  const after = store.report(task.id);
  assert.notEqual(after.id, before.id);
  assert.equal(after.checks[0].verdict, 'failed');
  assert.deepEqual(store.readReport(before.id), before);
  assert.equal(after.status, 'cancelled');
  assert.equal(after.stopReason, 'cancelled');
});

test('invalid records, secrets in extra fields and stale attempts are rejected atomically', t => {
  const { store, task } = setup(t);
  store.transition(task.id, task.version, 'running');
  const before = store.events(task.id).length;
  for (const invalid of [{ ...command(), output: 'fake-secret' }, { ...command(), outputHash: 'wrong' }, { tool: 'write', path: '../escape', hash }]) {
    assert.throws(() => store.recordTool(task.id, 0, invalid));
  }
  assert.throws(() => store.recordTool(task.id, 1, command()));
  assert.equal(store.events(task.id).length, before);
});

test('failure, cancellation and timeout retain reports without fabricating checks', async t => {
  for (const mode of ['failed', 'cancelled', 'timeout']) {
    const { store, task } = setup(t);
    const controller = new AbortController();
    if (mode === 'cancelled') controller.abort();
    const result = await runTask(store, task.id, {
      timeoutMs: 20, signal: controller.signal,
      runtime: { execute: async () => {
        if (mode === 'timeout') return new Promise(() => {});
        throw new Error('fake-sensitive-error');
      } }, evaluator: { verify: () => { throw new Error('must not run'); } },
    });
    const report = store.report(task.id);
    assert.equal(report.status, mode === 'cancelled' ? 'cancelled' : 'failed');
    assert.equal(report.verification, 'not_run');
    assert.equal(report.checks[0].verdict, 'not_run');
    assert.equal(report.stopReason, mode === 'failed' ? 'adapter_failed' : mode);
    assert.equal(result.status, report.status);
  }
});

test('an evaluator pass alone does not claim any command was run', async t => {
  const { store, task } = setup(t);
  await runTask(store, task.id, { runtime: { execute: async () => {} }, evaluator: { verify: async () => ({ verdict: 'passed', evidence: 'trusted evaluator only' }) } });
  const report = store.report(task.id);
  assert.equal(report.verification, 'passed');
  assert.equal(report.checks[0].verdict, 'not_run');
  assert.equal(report.acceptance, 'needs_human_review');
});

test('a new repair attempt cannot reuse the preceding command result', t => {
  const { store, task } = setup(t, 1);
  let current = store.transition(task.id, task.version, 'running');
  store.recordTool(task.id, 0, command(1));
  current = store.transition(task.id, current.version, 'verifying');
  current = store.verification(task.id, current.version, 'failed', 'fixture failure');
  current = store.transition(task.id, current.version, 'repairing');
  current = store.transition(task.id, current.version, 'running');
  const report = store.report(task.id);
  assert.equal(report.attempt, 1);
  assert.equal(report.tools.length, 1);
  assert.equal(report.checks[0].verdict, 'not_run');
  assert.throws(() => store.recordTool(task.id, 0, command(0)));
});
