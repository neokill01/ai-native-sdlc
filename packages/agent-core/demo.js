// Deterministic fixture only: approval and verification identities are synthetic.
import { TaskStore } from './index.js';
import { runTask } from './loop.js';
const store = new TaskStore(':memory:');
try {
  let task = store.create('Fixture: fail first verification, repair once, then pass');
  task = store.artifact(task.id, task.version, 'intent', 'Deterministic fixture only');
  task = store.transition(task.id, task.version, 'intent_review');
  for (const [kind, target] of [['intent', 'spec_review'], ['spec', 'plan_review'], ['plan', 'queued']]) {
    if (kind !== 'intent') task = store.artifact(task.id, task.version, kind, 'Fixture artifact');
    task = store.approve(task.id, task.version, 'fixture-reviewer');
    task = store.transition(task.id, task.version, target);
  }
  let attempts = 0;
  const result = await runTask(store, task.id, {
    runtime: { execute: async () => { attempts++; } },
    evaluator: { verify: async () => ({ verdict: attempts === 1 ? 'failed' : 'passed', evidence: `synthetic verification attempt ${attempts}` }) },
  });
  console.log(JSON.stringify({ mode: 'deterministic_fixture', status: result.status, attempts, repairs: result.repairs, verification: result.verification, events: store.events(task.id).map(e => e.type) }, null, 2));
} finally { store.close(); }
