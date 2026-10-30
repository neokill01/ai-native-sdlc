/** Real file/test execution, deterministic coding decisions. Trusted fixture only. */
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore } from './index.js';
import { runTask } from './loop.js';
import { WorkspaceTools } from '../tool-kit/index.js';

export async function workspaceDemo() {
  const root = await mkdtemp(join(tmpdir(), 'devos-fixture-'));
  const store = new TaskStore(join(root, 'tasks.db'));
  try {
    // Trusted fixture setup; task tools are only allowed to change src/.
    await writeFile(join(root, 'verify.mjs'), `import assert from 'node:assert/strict';\nimport { add } from './src/add.mjs';\nassert.equal(add(2, 3), 5);\nassert.equal(add(-1, 1), 0);\n`);
    let task = store.create('Fixture: implement add; pass the prewritten assertions', { maxRepairs: 1 });
    task = store.artifact(task.id, task.version, 'intent', 'Trusted deterministic fixture');
    task = store.transition(task.id, task.version, 'intent_review');
    for (const [kind, target] of [['intent', 'spec_review'], ['spec', 'plan_review'], ['plan', 'queued']]) {
      if (kind !== 'intent') task = store.artifact(task.id, task.version, kind, 'Only src/add.mjs may change; verify.mjs is immutable to task tools');
      task = store.approve(task.id, task.version, 'fixture-reviewer');
      task = store.transition(task.id, task.version, target);
    }
    const id = task.id;
    const tools = await WorkspaceTools.create({ root, writable: ['src/add.mjs'], trustedLocal: true,
      authorizeWrite: () => {
        const current = store.get(id);
        return current.status === 'running' && ['intent', 'spec', 'plan'].every(k => current.approvals[k]?.hash === current.artifacts[k]?.hash);
      },
      commands: { test: { executable: process.execPath, args: ['verify.mjs'] } },
    });
    let attempts = 0;
    const commands = [];
    const result = await runTask(store, id, {
      runtime: { execute: async ({ signal }) => {
        signal.throwIfAborted();
        attempts++;
        await tools.write('src/add.mjs', attempts === 1 ? 'export const add = (a,b) => a-b;\n' : 'export const add = (a,b) => a+b;\n');
      } },
      evaluator: { verify: async ({ signal }) => {
        const command = await tools.command('test', { signal });
        commands.push(command);
        return { verdict: command.exitCode === 0 && !command.reason ? 'passed' : 'failed', evidence: JSON.stringify(command) };
      } },
    });
    return { mode: 'trusted_local_deterministic_fixture', status: result.status, attempts, repairs: result.repairs,
      verification: result.verification, commands, tools: tools.records, eventCount: store.events(id).length };
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
}
if (process.argv[1] === new URL(import.meta.url).pathname) console.log(JSON.stringify(await workspaceDemo(), null, 2));
