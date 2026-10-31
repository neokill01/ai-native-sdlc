/** Local single-worker prototype. Callers must provide authenticated approval actors.
 * This module does not execute tools, authorize identities, or create a sandbox.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { initializeEvidence, recordTool, captureReport } from './evidence.js';
import { initializeLeases, acquireTaskLease, renewTaskLease, releaseTaskLease, assertTaskLease, currentTaskLease } from './leases.js';
import { initializeWorktrees } from './worktrees.js';

const next = {
  created: ['intent_review'], intent_review: ['spec_review'],
  spec_review: ['plan_review'], plan_review: ['queued'],
  queued: ['running', 'cancelled', 'failed'], running: ['verifying', 'failed', 'paused', 'cancelled'],
  verifying: ['completed', 'repairing', 'failed', 'paused', 'cancelled'],
  repairing: ['running', 'failed', 'paused', 'cancelled'], paused: ['queued', 'cancelled'],
};
const artifactKind = { intent_review: 'intent', spec_review: 'spec', plan_review: 'plan' };

export class TaskStore {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, version INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id), type TEXT NOT NULL, payload TEXT NOT NULL);
    `);
    initializeEvidence(this.db);
    initializeLeases(this.db);
    initializeWorktrees(this.db);
  }
  recordTool(id, attempt, record, lease = null) { return recordTool(this, id, attempt, record, lease); }
  acquireLease(id, owner, ttlMs, now) { return acquireTaskLease(this, id, owner, ttlMs, now); }
  renewLease(id, lease, ttlMs, now) { return renewTaskLease(this, id, lease, ttlMs, now); }
  releaseLease(id, lease, now) { return releaseTaskLease(this, id, lease, now); }
  assertLease(id, lease, now) { return assertTaskLease(this, id, lease, now); }
  currentLease(id, now) { return currentTaskLease(this, id, now); }
  reserveWorktree(id, lease, record) {
    if (!record || typeof record.path !== 'string' || !isAbsolute(record.path) || typeof record.repository !== 'string' || !isAbsolute(record.repository) || typeof record.branch !== 'string' || (() => { const parts = record.branch.split('/'); return parts.length !== 4 || parts[0] !== 'devos' || parts[1] !== 'tasks' || !/^[a-zA-Z0-9-]{1,64}$/.test(parts[2]) || !/^fence-[1-9][0-9]*$/.test(parts[3]); })() || typeof record.baseRef !== 'string' || !record.baseRef || record.baseRef.length > 256) throw new Error('Invalid worktree record');
    this.assertLease(id, lease);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.assertLease(id, lease);
      const now = new Date().toISOString();
      this.db.prepare('INSERT INTO task_worktrees(task_id,fencing_token,path,branch,base_ref,repository,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id, lease.fencingToken, record.path, record.branch, record.baseRef, record.repository, 'creating', now, now);
      this.event(id, 'worktree.create_requested', { fencingToken: lease.fencingToken, branch: record.branch, pathHash: createHash('sha256').update(record.path).digest('hex') });
      this.db.exec('COMMIT');
      return this.getWorktree(id, lease, lease.fencingToken);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  getWorktree(id, lease, fencingToken = lease?.fencingToken) {
    this.assertLease(id, lease);
    if (!Number.isSafeInteger(fencingToken) || fencingToken > lease.fencingToken) throw new Error('Invalid worktree fencing token');
    const row = this.db.prepare('SELECT * FROM task_worktrees WHERE task_id=? AND fencing_token=?').get(id, fencingToken);
    if (!row) throw new Error('Worktree record not found');
    return row;
  }
  listWorktrees(id, lease) {
    this.assertLease(id, lease);
    return this.db.prepare('SELECT * FROM task_worktrees WHERE task_id=? ORDER BY fencing_token').all(id);
  }
  updateWorktree(id, lease, fencingToken, state, headSha = null) {
    const allowed = { creating: ['ready','failed','orphaned','missing'], ready: ['ready','removing','missing','orphaned'], removing: ['removed','ready','orphaned'], failed: ['orphaned'], missing: ['ready','orphaned'], orphaned: ['removing','removed'], removed: [] };
    if (!Object.hasOwn(allowed, state)) throw new Error('Invalid worktree state');
    this.assertLease(id, lease);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.assertLease(id, lease);
      if (fencingToken > lease.fencingToken) throw new Error('Stale worktree fencing token');
      const current = this.db.prepare('SELECT state FROM task_worktrees WHERE task_id=? AND fencing_token=?').get(id, fencingToken);
      if (!current || (current.state !== state && !allowed[current.state]?.includes(state))) throw new Error('Invalid worktree state transition');
      if (headSha !== null && !/^[a-f0-9]{40,64}$/.test(headSha)) throw new Error('Invalid worktree HEAD');
      const now = new Date().toISOString();
      this.db.prepare('UPDATE task_worktrees SET state=?,head_sha=COALESCE(?,head_sha),updated_at=? WHERE task_id=? AND fencing_token=?').run(state, headSha, now, id, fencingToken);
      this.event(id, 'worktree.state_changed', { fencingToken, from: current.state, to: state, headSha });
      this.db.exec('COMMIT');
      return this.getWorktree(id, lease, fencingToken);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  report(id) { return captureReport(this, id); }
  readReport(id) {
    const row = this.db.prepare('SELECT data FROM reports WHERE id=?').get(id);
    if (!row) throw new Error('Report not found');
    return JSON.parse(row.data);
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
  mutate(id, version, type, change, lease = null) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const task = this.get(id);
      if (lease) this.assertLease(id, lease);
      if (task.version !== version) throw new Error('Stale task version');
      const detail = change(task) ?? {};
      task.version++;
      this.db.prepare('UPDATE tasks SET version=?,data=? WHERE id=? AND version=?').run(task.version, JSON.stringify(task), id, version);
      this.event(id, type, { ...detail, version: task.version, status: task.status });
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
      return { kind, ...task.approvals[kind] };
    });
  }
  verification(id, version, verdict, evidence, lease = null) {
    if (!['passed', 'failed'].includes(verdict) || typeof evidence !== 'string' || !evidence.trim()) throw new Error('Verification evidence required');
    return this.mutate(id, version, 'verification.recorded', task => {
      if (task.status !== 'verifying') throw new Error('Not verifying');
      task.verification = verdict;
      task.evidenceHash = createHash('sha256').update(evidence).digest('hex');
      return { verdict, evidenceHash: task.evidenceHash, attempt: task.repairs };
    }, lease);
  }
  checkpoint(id, version, detail, lease = null) {
    return this.mutate(id, version, 'run.checkpoint', task => {
      if (!['running', 'verifying', 'repairing'].includes(task.status)) throw new Error('Not active');
      task.checkpoint = { ...task.checkpoint, ...detail };
      return { checkpoint: task.checkpoint };
    }, lease);
  }
  resolvePending(id, version, { actor, decision, evidence } = {}) {
    if (typeof actor !== 'string' || !actor.trim() || actor.length > 128 ||
        !['completed', 'not_executed'].includes(decision) ||
        typeof evidence !== 'string' || !evidence.trim() || evidence.length > 4096) throw new Error('Manual resolution evidence required');
    const evidenceHash = createHash('sha256').update(evidence).digest('hex');
    return this.mutate(id, version, 'run.pending_resolved', task => {
      if (task.status !== 'paused' || task.checkpoint?.operation !== 'pending') throw new Error('No uncertain operation awaiting resolution');
      if (this.currentLease(id)) throw new Error('Task is still leased');
      const operationKey = task.checkpoint.operationKey;
      task.checkpoint.resolution = { actor, decision, evidenceHash, at: new Date().toISOString() };
      if (decision === 'completed') task.checkpoint.operation = 'finished';
      else {
        task.checkpoint.lastUncertainOperationKey = operationKey;
        delete task.checkpoint.operation;
        delete task.checkpoint.operationKey;
      }
      task.status = 'queued';
      return { actor, decision, operationKey, evidenceHash };
    });
  }
  transition(id, version, status, reason = null, lease = null) {
    if (reason !== null && (!['failed', 'cancelled', 'paused'].includes(status) ||
      !['timeout', 'cancelled', 'repair_budget_exceeded', 'adapter_failed', 'uncertain_operation'].includes(reason))) throw new Error('Invalid stop reason');
    return this.mutate(id, version, 'task.transitioned', task => {
      if (!next[task.status]?.includes(status)) throw new Error('Invalid transition');
      const kind = artifactKind[task.status];
      if (kind && (!task.artifacts[kind] || task.approvals[kind]?.hash !== task.artifacts[kind].hash)) throw new Error('Artifact approval required');
      if (status === 'running') {
        if (['intent', 'spec', 'plan'].some(k => !task.artifacts[k] || task.approvals[k]?.hash !== task.artifacts[k].hash)) throw new Error('Approved artifact chain required');
        if (task.status === 'repairing') task.checkpoint = { deadline: task.checkpoint?.deadline };
        task.verification = 'not_run';
        delete task.evidence;
        delete task.evidenceHash;
      }
      if (status === 'repairing') {
        if (task.verification !== 'failed') throw new Error('Failed verification required');
        if (task.repairs >= task.maxRepairs) throw new Error('Repair budget exceeded');
        task.repairs++;
      }
      if (status === 'completed' && task.verification !== 'passed') throw new Error('Passing evidence required');
      task.status = status;
      if (reason) task.stopReason = reason;
      else delete task.stopReason;
      return { reason };
    }, lease);
  }
}

export { OpenAIResponsesRuntime, ApprovedPlanEvaluator } from './openai-runtime.js';

export { runTask } from './loop.js';
