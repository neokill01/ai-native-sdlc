import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore } from '../index.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'devos-'));
  const filename = join(dir, 'task.db');
  const store = new TaskStore(filename);
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  return { store, filename };
}
function queued(store, options) {
  let task = store.create('Implement a bounded change', options);
  task = store.artifact(task.id, task.version, 'intent', 'goal');
  task = store.transition(task.id, task.version, 'intent_review');
  for (const [kind, target] of [['intent', 'spec_review'], ['spec', 'plan_review'], ['plan', 'queued']]) {
    if (kind !== 'intent') task = store.artifact(task.id, task.version, kind, 'approved content');
    task = store.approve(task.id, task.version, 'human-reviewer');
    task = store.transition(task.id, task.version, target);
  }
  return task;
}

test('approval gates and stale updates leave no event or state changes', t => {
  const { store } = fixture(t);
  let task = store.create('a change');
  assert.throws(() => store.transition(task.id, task.version, 'running'));
  task = store.artifact(task.id, task.version, 'intent', 'goal');
  task = store.transition(task.id, task.version, 'intent_review');
  const count = store.events(task.id).length;
  assert.throws(() => store.transition(task.id, task.version, 'spec_review'));
  assert.throws(() => store.approve(task.id, task.version - 1, 'reviewer'));
  assert.equal(store.events(task.id).length, count);
  assert.deepEqual(store.get(task.id), task);
});

test('artifact changes invalidate downstream approvals', t => {
  const { store } = fixture(t);
  let task = store.create('change');
  task = store.artifact(task.id, task.version, 'intent', 'goal');
  task = store.transition(task.id, task.version, 'intent_review');
  task = store.approve(task.id, task.version, 'reviewer');
  task = store.transition(task.id, task.version, 'spec_review');
  task = store.artifact(task.id, task.version, 'intent', 'new goal');
  assert.equal(task.status, 'intent_review');
  assert.deepEqual(task.approvals, {});
  assert.throws(() => store.transition(task.id, task.version, 'spec_review'));
});

test('bounded repairs and not_run cannot be reported as completed', t => {
  const { store } = fixture(t);
  let task = queued(store, { maxRepairs: 1 });
  task = store.transition(task.id, task.version, 'running');
  task = store.transition(task.id, task.version, 'verifying');
  assert.equal(task.verification, 'not_run');
  assert.throws(() => store.transition(task.id, task.version, 'completed'));
  task = store.verification(task.id, task.version, 'failed', 'test exit 1');
  task = store.transition(task.id, task.version, 'repairing');
  task = store.transition(task.id, task.version, 'running');
  task = store.transition(task.id, task.version, 'verifying');
  task = store.verification(task.id, task.version, 'failed', 'test exit 1');
  assert.throws(() => store.transition(task.id, task.version, 'repairing'));
  task = store.verification(task.id, task.version, 'passed', 'test exit 0');
  task = store.transition(task.id, task.version, 'completed');
  assert.equal(task.status, 'completed');
});

test('reopening database preserves approval, task version and ordered events', t => {
  const { store, filename } = fixture(t);
  let task = queued(store);
  task = store.transition(task.id, task.version, 'running');
  task = store.transition(task.id, task.version, 'paused');
  const reopened = new TaskStore(filename);
  try {
    assert.deepEqual(reopened.get(task.id), task);
    assert.deepEqual(reopened.events(task.id), store.events(task.id));
    task = reopened.transition(task.id, task.version, 'queued');
    assert.equal(task.status, 'queued');
  } finally { reopened.close(); }
});
