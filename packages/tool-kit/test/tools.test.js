import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, symlink, link, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorkspaceTools } from '../index.js';

async function setup(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'devos-tools-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, tools: await WorkspaceTools.create({ root, writable: ['src/'], authorizeWrite: () => true, ...options }) };
}

test('path allowlist, approval, secrets and symlinks prevent writes', async t => {
  const { root, tools } = await setup(t);
  for (const name of ['../escape', '/tmp/escape', '.git/config', '.env', 'src/../outside.js']) await assert.rejects(() => tools.write(name, 'x'));
  await tools.write('src/a.js', 'export const value = 1;');
  assert.equal(await tools.read('src/a.js'), 'export const value = 1;');
  await assert.rejects(() => tools.write('src/key.js', 'api_key = "fake-test-value"'));
  await symlink('/tmp', join(root, 'src/escape'));
  await assert.rejects(() => tools.write('src/escape/a', 'x'));
  const denied = await WorkspaceTools.create({ root, writable: ['src/'], authorizeWrite: () => false });
  await assert.rejects(() => denied.write('src/a.js', 'overwrite'));
});

test('hard-linked file is not truncated', async t => {
  const { root, tools } = await setup(t);
  await tools.write('src/original', 'keep');
  await link(join(root, 'src/original'), join(root, 'src/alias'));
  await assert.rejects(() => tools.write('src/alias', 'destroy'));
  assert.equal(await readFile(join(root, 'src/original'), 'utf8'), 'keep');
});

test('commands disabled by default and require configured names', async t => {
  const { tools } = await setup(t);
  await assert.rejects(() => tools.command('test'));
  const { tools: local } = await setup(t, { trustedLocal: true });
  await assert.rejects(() => local.command('arbitrary'));
});

test('real command evidence excludes output and inherited secrets', async t => {
  const { tools } = await setup(t, { trustedLocal: true, commands: { test: { executable: process.execPath, args: ['-e', 'console.log(process.env.HOME ?? "clean")'] } } });
  const result = await tools.command('test');
  assert.equal(result.exitCode, 0);
  assert.equal(result.reason, null);
  assert.equal(result.outputBytes, 6);
  assert.ok(result.outputHash);
  assert.equal(Object.hasOwn(result, 'output'), false);
});

test('timeouts, cancellation and output limits terminate commands', async t => {
  const { tools } = await setup(t, { trustedLocal: true, commands: {
    wait: { executable: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'] },
    flood: { executable: process.execPath, args: ['-e', 'console.log("x".repeat(10000))'] },
  } });
  assert.equal((await tools.command('wait', { timeoutMs: 30 })).reason, 'timeout');
  const controller = new AbortController();
  const pending = tools.command('wait', { signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  assert.equal((await pending).reason, 'cancelled');
  assert.equal((await tools.command('flood', { maxOutputBytes: 100 })).reason, 'output_limit');
});
