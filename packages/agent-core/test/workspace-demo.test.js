import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspaceDemo } from '../workspace-demo.js';

test('real test exits drive deterministic repair in a temporary workspace', async () => {
  const report = await workspaceDemo();
  assert.equal(report.status, 'completed');
  assert.equal(report.repairs, 1);
  assert.equal(report.attempts, 2);
  assert.deepEqual(report.commands.map(c => c.exitCode), [1, 0]);
  assert.ok(report.commands.every(c => c.outputHash && c.reason === null));
  assert.deepEqual(report.tools.filter(t => t.tool === 'write').map(t => t.path), ['src/add.mjs', 'src/add.mjs']);
});
