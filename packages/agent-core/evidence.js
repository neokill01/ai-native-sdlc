import { createHash } from 'node:crypto';
const digest = value => createHash('sha256').update(value).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;

/** Narrow metadata schema: raw content, output, arguments and environment are rejected. */
export function validateRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid tool record');
  const keys = record.tool === 'command'
    ? ['tool', 'command', 'exitCode', 'signal', 'reason', 'durationMs', 'outputBytes', 'outputHash']
    : ['tool', 'path', 'hash'];
  if (Object.keys(record).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(record, key))) throw new Error('Unsupported tool record fields');
  if (record.tool === 'command') {
    if (!identifier(record.command) || !(record.exitCode === null || integer(record.exitCode)) ||
      !(record.signal === null || /^SIG[A-Z0-9]+$/.test(record.signal)) ||
      ![null, 'timeout', 'cancelled', 'output_limit', 'spawn_failed'].includes(record.reason) ||
      !integer(record.durationMs) || !integer(record.outputBytes) || !hex(record.outputHash)) throw new Error('Invalid command evidence');
  } else if (['read', 'write'].includes(record.tool)) {
    if (typeof record.path !== 'string' || record.path.length > 1024 || !record.path || record.path.startsWith('/') ||
      record.path.includes('\\') || record.path.split('/').some(p => !p || p === '..' || p === '.' || p === '.git' || p === '.env' || p.startsWith('.env.')) ||
      /[\x00-\x1f]/.test(record.path) || !hex(record.hash)) throw new Error('Invalid file evidence');
  } else throw new Error('Unknown tool');
  return structuredClone(record);
}

export function initializeEvidence(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS reports(
    id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
    task_version INTEGER NOT NULL, event_sequence INTEGER NOT NULL, data TEXT NOT NULL,
    UNIQUE(task_id,task_version,event_sequence));`);
}

export function recordTool(store, id, attempt, record) {
  const clean = validateRecord(record);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const task = store.get(id);
    if (!integer(attempt) || attempt !== task.repairs || !['running', 'verifying', 'failed', 'cancelled'].includes(task.status)) throw new Error('Tool evidence outside current attempt');
    store.event(id, 'tool.recorded', { attempt, operationKey: `${id}:${attempt}`, taskVersion: task.version, record: clean });
    store.db.exec('COMMIT');
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
}

/** Snapshot is immutable; late tool evidence produces a new report revision. */
export function captureReport(store, id) {
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const task = store.get(id);
    const events = store.events(id);
    const sequence = events.at(-1)?.sequence ?? 0;
    const existing = store.db.prepare('SELECT data FROM reports WHERE task_id=? AND task_version=? AND event_sequence=?').get(id, task.version, sequence);
    if (existing) { store.db.exec('COMMIT'); return JSON.parse(existing.data); }
    const tools = events.filter(e => e.type === 'tool.recorded').map(e => ({ sequence: e.sequence, at: e.payload.occurredAt, ...e.payload }));
    const current = tools.filter(e => e.attempt === task.repairs && e.record.tool === 'command');
    const latest = new Map(current.map(e => [e.record.command, e]));
    const commands = [...latest.values()].map(e => ({ check: e.record.command,
      verdict: e.record.reason || e.record.signal || e.record.exitCode !== 0 ? 'failed' : 'passed', evidenceSequence: e.sequence }));
    const report = {
      schemaVersion: 1, taskId: id, taskVersion: task.version, eventSequence: sequence,
      status: task.status, stopReason: task.stopReason ?? null, attempt: task.repairs, createdAt: new Date().toISOString(),
      verification: task.verification, verificationEvidenceHash: task.evidenceHash ?? null,
      checks: commands.length ? commands : [{ check: 'commands', verdict: 'not_run' }],
      acceptance: 'needs_human_review', tools,
      approvals: events.filter(e => e.type === 'approval.recorded').map(e => ({ sequence: e.sequence, ...e.payload })),
    };
    const reportId = digest(JSON.stringify(report));
    const data = { id: reportId, ...report };
    store.db.prepare('INSERT INTO reports VALUES(?,?,?,?,?)').run(reportId, id, task.version, sequence, JSON.stringify(data));
    store.db.exec('COMMIT');
    return data;
  } catch (error) { store.db.exec('ROLLBACK'); throw error; }
}
