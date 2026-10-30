/** Filesystem policy + trusted local command harness. NOT an OS sandbox. */
import { constants } from 'node:fs';
import { lstat, realpath, open, mkdir } from 'node:fs/promises';
import { resolve, relative, sep, dirname, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const sensitive = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|\b(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*["'][^"'\r\n]{6,})/i;
const hash = value => createHash('sha256').update(value).digest('hex');

export class WorkspaceTools {
  static async create({ root, writable = [], commands = {}, authorizeWrite, trustedLocal = false }) {
    if (!Array.isArray(writable) || writable.some(p => typeof p !== 'string' || !p || isAbsolute(p) || p.split(/[\\/]/).includes('..'))) throw new Error('Invalid writable paths');
    if (typeof authorizeWrite !== 'function') throw new Error('Write authorization required');
    const tools = new WorkspaceTools();
    tools.root = await realpath(root);
    tools.writable = [...writable];
    tools.commands = structuredClone(commands);
    tools.authorizeWrite = authorizeWrite;
    tools.trustedLocal = trustedLocal;
    tools.records = [];
    return tools;
  }
  async path(name) {
    if (typeof name !== 'string' || !name || name.includes('\0') || name.includes('\\') || isAbsolute(name)) throw new Error('Invalid workspace path');
    const path = resolve(this.root, name);
    const local = relative(this.root, path);
    if (!local || local === '..' || local.startsWith(`..${sep}`) || isAbsolute(local)) throw new Error('Path leaves workspace');
    const parts = local.split(sep);
    if (parts.some(p => p === '.git' || p === '.env' || p.startsWith('.env.'))) throw new Error('Sensitive path denied');
    let cursor = this.root;
    for (const part of parts) {
      cursor = resolve(cursor, part);
      try {
        if ((await lstat(cursor)).isSymbolicLink()) throw new Error('Symbolic links denied');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return { path, local };
  }
  async read(name) {
    const { path, local } = await this.path(name);
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size > 1024 * 1024) throw new Error('File type or size denied');
      const content = await file.readFile('utf8');
      if (sensitive.test(content)) throw new Error('Sensitive content denied');
      this.records.push({ tool: 'read', path: local, hash: hash(content) });
      return content;
    } finally { await file.close(); }
  }
  async write(name, content) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > 1024 * 1024 || sensitive.test(content)) throw new Error('Invalid or sensitive content');
    const { path, local } = await this.path(name);
    if (!this.writable.some(p => local === p || (p.endsWith('/') && local.startsWith(p)))) throw new Error('Write outside allowlist');
    if (!(await this.authorizeWrite())) throw new Error('Approved running task required');
    await mkdir(dirname(path), { recursive: true });
    await this.path(name);
    const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.nlink !== 1) throw new Error('File type or hard link denied');
      await file.truncate(0);
      await file.writeFile(content);
    } finally { await file.close(); }
    this.records.push({ tool: 'write', path: local, hash: hash(content) });
  }
  async command(name, { signal, timeoutMs = 5000, maxOutputBytes = 65536 } = {}) {
    // Caller cannot provide executable, arguments, shell string or environment.
    if (!this.trustedLocal) throw new Error('Sandbox required: local commands disabled');
    const spec = Object.hasOwn(this.commands, name) ? this.commands[name] : undefined;
    if (!spec || typeof spec.executable !== 'string' || !isAbsolute(spec.executable) || !Array.isArray(spec.args) || spec.args.some(a => typeof a !== 'string')) throw new Error('Command not allowlisted');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) throw new Error('Invalid command limits');
    signal?.throwIfAborted();
    const started = Date.now();
    return new Promise((resolveResult, reject) => {
      let timer, stopped, size = 0;
      const chunks = [];
      const child = spawn(spec.executable, spec.args, { cwd: this.root, shell: false, detached: process.platform !== 'win32', env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, stdio: ['ignore', 'pipe', 'pipe'] });
      const stop = reason => {
        stopped ??= reason;
        try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') child.kill('SIGKILL'); }
      };
      const abort = () => stop('cancelled');
      const collect = chunk => {
        size += chunk.length;
        if (size > maxOutputBytes) stop('output_limit');
        else chunks.push(chunk);
      };
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('error', () => { cleanup(); reject(new Error('Command spawn failed')); });
      child.once('close', (exitCode, exitSignal) => {
        cleanup();
        const output = Buffer.concat(chunks);
        // Store only hashes and metadata. Raw process output may contain secrets.
        const result = { command: name, exitCode, signal: exitSignal, reason: stopped ?? null, durationMs: Date.now() - started, outputBytes: size, outputHash: hash(output) };
        this.records.push({ tool: 'command', ...result });
        resolveResult(result);
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      timer = setTimeout(() => stop('timeout'), timeoutMs);
    });
  }
}
