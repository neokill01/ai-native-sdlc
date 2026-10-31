import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskStore } from '../index.js';
import { runTask } from '../loop.js';

function setup(t, maxRepairs = 2) {
  const store = new TaskStore(':memory:');
  t.after(() => store.close());
  let task = store.create('test deterministic loop', { maxRepairs });
  task = store.artifact(task.id, task.version, 'intent', 'intent');
  task = store.transition(task.id, task.version, 'intent_review');
  for (const [kind, target] of [['intent', 'spec_review'], ['spec', 'plan_review'], ['plan', 'queued']]) {
    if (kind !== 'intent') task = store.artifact(task.id, task.version, kind, kind);
    task = store.approve(task.id, task.version, 'test-human');
    task = store.transition(task.id, task.version, target);
  }
  return { store, task };
}

test('executes, verifies, repairs and completes with stable operation keys', async t => {
  const { store, task } = setup(t);
  const keys = [];
  const result = await runTask(store, task.id, {
    runtime: { execute: async ({ operationKey }) => { keys.push(operationKey); } },
    evaluator: { verify: async () => ({ verdict: keys.length === 1 ? 'failed' : 'passed', evidence: `fixture attempt ${keys.length}` }) },
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.repairs, 1);
  assert.equal(new Set(keys).size, 2);
  const approval = store.events(task.id).find(e => e.type === 'approval.recorded');
  assert.equal(approval.payload.actor, 'test-human');
  assert.ok(approval.payload.hash);
});

test('persistent failures stop at repair budget', async t => {
  const { store, task } = setup(t, 1);
  let calls = 0;
  const result = await runTask(store, task.id, {
    runtime: { execute: async () => { calls++; } },
    evaluator: { verify: async () => ({ verdict: 'failed', evidence: 'fixture exit 1' }) },
  });
  assert.equal(result.status, 'failed');
  assert.equal(calls, 2);
});

test('uncertain pending execution pauses without replay', async t => {
  const { store, task: original } = setup(t);
  let task = store.transition(original.id, original.version, 'running');
  task = store.checkpoint(task.id, task.version, { operation: 'pending', operationKey: 'uncertain' });
  let calls = 0;
  const result = await runTask(store, task.id, { runtime: { execute: () => { calls++; } }, evaluator: { verify: () => {} } });
  assert.equal(result.status, 'paused');
  assert.equal(calls, 0);
});

test('timeout and cancellation abort adapter and never mark completed', async t => {
  for (const cancel of [false, true]) {
    const { store, task } = setup(t);
    const controller = new AbortController();
    let aborted = false;
    const timer = cancel ? setTimeout(() => controller.abort(), 15) : undefined;
    const result = await runTask(store, task.id, {
      timeoutMs: 30, signal: controller.signal,
      runtime: { execute: ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); }, { once: true });
      }) }, evaluator: { verify: () => { throw new Error('must not verify'); } },
    });
    clearTimeout(timer);
    assert.equal(result.status, cancel ? 'cancelled' : 'failed');
    assert.equal(result.verification, 'not_run');
    assert.equal(aborted, true);
  }
});

test('verifying checkpoint resumes without executing code again', async t => {
  const { store, task: original } = setup(t);
  let task = store.transition(original.id, original.version, 'running');
  task = store.transition(task.id, task.version, 'verifying');
  const result = await runTask(store, task.id, {
    runtime: { execute: () => { throw new Error('must not replay'); } },
    evaluator: { verify: async () => ({ verdict: 'passed', evidence: 'read-only fixture' }) },
  });
  assert.equal(result.status, 'completed');
});

test('finished execution checkpoint does not replay after interruption', async t => {
  const { store, task: original } = setup(t);
  let task = store.transition(original.id, original.version, 'running');
  task = store.checkpoint(task.id, task.version, { operation: 'finished', deadline: Date.now() + 1000 });
  const result = await runTask(store, task.id, {
    runtime: { execute: () => { throw new Error('must not replay'); } },
    evaluator: { verify: async () => ({ verdict: 'passed', evidence: 'fixture resumed' }) },
  });
  assert.equal(result.status, 'completed');
});

test('expired persisted deadline cannot be reset on recovery', async t => {
  const { store, task: original } = setup(t);
  let task = store.transition(original.id, original.version, 'running');
  task = store.checkpoint(task.id, task.version, { operation: 'finished', deadline: Date.now() - 1 });
  const result = await runTask(store, task.id, {
    timeoutMs: 100000,
    runtime: { execute: () => { throw new Error('must not execute'); } },
    evaluator: { verify: () => { throw new Error('must not verify'); } },
  });
  assert.equal(result.status, 'failed');
});

test('manual reconciliation can resume an uncertain operation as completed without replay', async t => {
  const { store, task: original } = setup(t);
  let task = store.transition(original.id, original.version, 'running');
  task = store.checkpoint(task.id, task.version, { operation: 'pending', operationKey: 'uncertain-completed', deadline: Date.now() + 10_000 });
  task = await runTask(store, task.id, { runtime: { execute: () => { throw new Error('must pause before replay'); } }, evaluator: { verify: () => {} } });
  assert.equal(task.status, 'paused');
  const resolved = store.resolvePending(task.id, task.version, { actor: 'operator', decision: 'completed', evidence: 'external job id 123 confirmed complete' });
  assert.equal(resolved.status, 'queued');
  assert.equal(resolved.checkpoint.operation, 'finished');
  const completed = await runTask(store, task.id, {
    runtime: { execute: () => { throw new Error('completed operation must not replay'); } },
    evaluator: { verify: async () => ({ verdict: 'passed', evidence: 'reconciled output verified' }) },
  });
  assert.equal(completed.status, 'completed');
});

test('manual reconciliation can authorize retry only after explicit not-executed evidence', async t => {
  const { store, task: original } = setup(t);
  let task = store.transition(original.id, original.version, 'running');
  task = store.checkpoint(task.id, task.version, { operation: 'pending', operationKey: 'uncertain-retry', deadline: Date.now() + 10_000 });
  task = await runTask(store, task.id, { runtime: { execute: () => { throw new Error('must pause before replay'); } }, evaluator: { verify: () => {} } });
  const resolved = store.resolvePending(task.id, task.version, { actor: 'operator', decision: 'not_executed', evidence: 'external job lookup confirms no operation was started' });
  assert.equal(resolved.status, 'queued');
  assert.equal(resolved.checkpoint.operation, undefined);
  let calls = 0;
  const completed = await runTask(store, task.id, {
    runtime: { execute: async ({ operationKey }) => { calls++; assert.equal(operationKey, 'uncertain-retry'); } },
    evaluator: { verify: async () => ({ verdict: 'passed', evidence: 'retry output verified' }) },
  });
  assert.equal(calls, 1);
  assert.equal(completed.status, 'completed');
});

test('manual resolution requires actor, evidence and an unleased paused task', async t => {
  const { store, task: original } = setup(t);
  let task = store.transition(original.id, original.version, 'running');
  task = store.checkpoint(task.id, task.version, { operation: 'pending', operationKey: 'uncertain-guard' });
  task = await runTask(store, task.id, { runtime: { execute: () => {} }, evaluator: { verify: () => {} } });
  assert.equal(task.status, 'paused');
  assert.throws(() => store.resolvePending(task.id, task.version, { actor: '', decision: 'completed', evidence: 'confirmed' }), /Manual resolution evidence required/);
  assert.throws(() => store.resolvePending(task.id, task.version, { actor: 'operator', decision: 'completed', evidence: '' }), /Manual resolution evidence required/);
  const lease = store.acquireLease(task.id, 'recovery-worker', 60_000);
  assert.throws(() => store.resolvePending(task.id, task.version, { actor: 'operator', decision: 'completed', evidence: 'confirmed' }), /still leased/);
  store.releaseLease(task.id, lease);
});
