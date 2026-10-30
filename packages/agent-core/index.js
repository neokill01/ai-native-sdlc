/** Local single-worker prototype. Callers must provide authenticated approval actors.
 * This module does not execute tools, authorize identities, or create a sandbox.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';

const next = {
  created: ['intent_review'], intent_review: ['spec_review'],
  spec_review: ['plan_review'], plan_review: ['queued'],
  queued: ['running'], running: ['verifying', 'failed', 'paused'],
  verifying: ['completed', 'repairing', 'failed', 'paused'],
  repairing: ['running', 'failed', 'paused'], paused: ['queued'],
};
const artifactKind = { intent_review: 'intent', spec_review: 'spec', plan_review: 'plan' };

export class TaskStore {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id), type TEXT NOT NULL, payload TEXT NOT NULL);
    `);
  }
  close() { this.db.close(); }
  get(id) {
    const row = this.db.prepare('SELECT data FROM tasks WHERE id=?').get(id);
    if (!row) throw new Error('Task not found');
    return JSON.parse(row.data);
  }
  events(id) { return this.db.prepare('SELECT * FROM events WHERE task_id=? ORDER BY sequence').all(id).map(x => ({ ...x, payload: JSON.parse(x.payload) })); }
  create(goal, { maxRepairs = 3 } = {}) {
    if (typeof goal !== 'string' || !goal.trim() || !Number.isSafeInteger(maxRepairs) || maxRepairs < 0) throw new Error('Invalid task');
    const task = { id: randomUUID(), goal, status: 'created', version: 0, artifacts: {}, approvals: {}, repairs: 0, maxRepairs, verification: 'not_run' };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO tasks VALUES(?,?,?)').run(task.id, 0, JSON.stringify(task));
      this.event(task.id, 'task.created', { version: 0 });
      this.db.exec('COMMIT');
      return task;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  event(id, type, payload) {
    this.db.prepare('INSERT INTO events(task_id,type,payload) VALUES(?,?,?)').run(id, type, JSON.stringify({ ...payload, occurredAt: new Date().toISOString() }));
  }
  mutate(id, version, type, change) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const task = this.get(id);
      if (task.version !== version) throw new Error('Stale task version');
      change(task);
      task.version++;
      this.db.prepare('UPDATE tasks SET version=?,data=? WHERE id=? AND version=?').run(task.version, JSON.stringify(task), id, version);
      this.event(id, type, { version: task.version, status: task.status });
      this.db.exec('COMMIT');
      return task;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  artifact(id, version, kind, content) {
    if (!['intent', 'spec', 'plan'].includes(kind) || typeof content !== 'string' || !content.trim()) throw new Error('Invalid artifact');
    return this.mutate(id, version, 'artifact.saved', task => {
      if (!['created', 'intent_review', 'spec_review', 'plan_review'].includes(task.status)) throw new Error('Artifacts locked after queueing');
      const order = ['intent', 'spec', 'plan'];
      const current = artifactKind[task.status] ?? 'intent';
      if (order.indexOf(kind) > order.indexOf(current)) throw new Error('Earlier review required');
      task.artifacts[kind] = { content, hash: createHash('sha256').update(content).digest('hex') };
      for (const downstream of order.slice(order.indexOf(kind))) {
        delete task.approvals[downstream];
        if (downstream !== kind) delete task.artifacts[downstream];
      }
      if (task.status !== 'created') task.status = `${kind}_review`;
    });
  }
  approve(id, version, actor) {
    if (typeof actor !== 'string' || !actor.trim()) throw new Error('Approval actor required');
    return this.mutate(id, version, 'approval.recorded', task => {
      const kind = artifactKind[task.status];
      if (!kind || !task.artifacts[kind]) throw new Error('No artifact awaiting approval');
      task.approvals[kind] = { hash: task.artifacts[kind].hash, actor, at: new Date().toISOString() };
    });
  }
  verification(id, version, verdict, evidence) {
    if (!['passed', 'failed'].includes(verdict) || typeof evidence !== 'string' || !evidence.trim()) throw new Error('Verification evidence required');
    return this.mutate(id, version, 'verification.recorded', task => {
      if (task.status !== 'verifying') throw new Error('Not verifying');
      task.verification = verdict;
      task.evidence = evidence;
    });
  }
  transition(id, version, status) {
    return this.mutate(id, version, 'task.transitioned', task => {
      if (!next[task.status]?.includes(status)) throw new Error('Invalid transition');
      const kind = artifactKind[task.status];
      if (kind && (!task.artifacts[kind] || task.approvals[kind]?.hash !== task.artifacts[kind].hash)) throw new Error('Artifact approval required');
      if (status === 'running') {
        if (['intent', 'spec', 'plan'].some(k => !task.artifacts[k] || task.approvals[k]?.hash !== task.artifacts[k].hash)) throw new Error('Approved artifact chain required');
        task.verification = 'not_run';
        delete task.evidence;
      }
      if (status === 'repairing') {
        if (task.verification !== 'failed') throw new Error('Failed verification required');
        if (task.repairs >= task.maxRepairs) throw new Error('Repair budget exceeded');
        task.repairs++;
      }
      if (status === 'completed' && task.verification !== 'passed') throw new Error('Passing evidence required');
      task.status = status;
    });
  }
}
