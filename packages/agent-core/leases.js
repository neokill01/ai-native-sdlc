import { randomUUID } from 'node:crypto';
const MIN_TTL_MS=1_000,MAX_TTL_MS=3_600_000;
const validTime=n=>Number.isSafeInteger(n)&&n>=0;
export function initializeLeases(db){db.exec(`CREATE TABLE IF NOT EXISTS task_lease_counters(task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,fencing_token INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS task_leases(task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,owner TEXT NOT NULL,token TEXT NOT NULL UNIQUE,fencing_token INTEGER NOT NULL,expires_at INTEGER NOT NULL,acquired_at INTEGER NOT NULL,renewed_at INTEGER NOT NULL);`);}
export function assertTaskLease(store,id,lease,now=Date.now()){
 if(!lease||lease.taskId!==id||typeof lease.owner!=='string'||typeof lease.token!=='string'||!Number.isSafeInteger(lease.fencingToken)||!validTime(now))throw new Error('Valid task lease required');
 const row=store.db.prepare('SELECT owner,token,fencing_token,expires_at FROM task_leases WHERE task_id=?').get(id);
 if(!row||row.owner!==lease.owner||row.token!==lease.token||row.fencing_token!==lease.fencingToken||row.expires_at<=now)throw new Error('Task lease lost or expired');
 return true;
}
export function acquireTaskLease(store,id,owner,ttlMs=60_000,now=Date.now()){
 if(typeof owner!=='string'||!/^[a-zA-Z0-9_.:@/-]{1,128}$/.test(owner)||!Number.isSafeInteger(ttlMs)||ttlMs<MIN_TTL_MS||ttlMs>MAX_TTL_MS||!validTime(now)||!Number.isSafeInteger(now+ttlMs))throw new Error('Invalid lease request');
 store.db.exec('BEGIN IMMEDIATE');
 try{
  store.get(id);
  const current=store.db.prepare('SELECT owner,fencing_token,expires_at FROM task_leases WHERE task_id=?').get(id);
  if(current&&current.expires_at>now)throw new Error('Task lease already held');
  if(current){store.db.prepare('DELETE FROM task_leases WHERE task_id=?').run(id);store.event(id,'task.lease_expired',{owner:current.owner,fencingToken:current.fencing_token});}
  const counter=store.db.prepare('SELECT fencing_token FROM task_lease_counters WHERE task_id=?').get(id);
  const fencingToken=(counter?.fencing_token??0)+1;
  store.db.prepare(`INSERT INTO task_lease_counters(task_id,fencing_token) VALUES(?,?) ON CONFLICT(task_id) DO UPDATE SET fencing_token=excluded.fencing_token`).run(id,fencingToken);
  const token=randomUUID(),expiresAt=now+ttlMs;
  store.db.prepare('INSERT INTO task_leases VALUES(?,?,?,?,?,?,?)').run(id,owner,token,fencingToken,expiresAt,now,now);
  store.event(id,'task.lease_acquired',{owner,fencingToken,expiresAt});
  store.db.exec('COMMIT');return Object.freeze({taskId:id,owner,token,fencingToken,expiresAt});
 }catch(e){store.db.exec('ROLLBACK');throw e;}
}
export function renewTaskLease(store,id,lease,ttlMs=60_000,now=Date.now()){
 if(!Number.isSafeInteger(ttlMs)||ttlMs<MIN_TTL_MS||ttlMs>MAX_TTL_MS||!validTime(now)||!Number.isSafeInteger(now+ttlMs))throw new Error('Invalid lease renewal');
 store.db.exec('BEGIN IMMEDIATE');
 try{
  assertTaskLease(store,id,lease,now);
  const expiresAt=now+ttlMs;
  store.db.prepare('UPDATE task_leases SET expires_at=?,renewed_at=? WHERE task_id=? AND token=? AND fencing_token=?').run(expiresAt,now,id,lease.token,lease.fencingToken);
  store.event(id,'task.lease_renewed',{owner:lease.owner,fencingToken:lease.fencingToken,expiresAt});
  store.db.exec('COMMIT');return Object.freeze({...lease,expiresAt});
 }catch(e){store.db.exec('ROLLBACK');throw e;}
}
export function releaseTaskLease(store,id,lease,now=Date.now()){
 store.db.exec('BEGIN IMMEDIATE');
 try{
  assertTaskLease(store,id,lease,now);
  store.db.prepare('DELETE FROM task_leases WHERE task_id=? AND token=? AND fencing_token=?').run(id,lease.token,lease.fencingToken);
  store.event(id,'task.lease_released',{owner:lease.owner,fencingToken:lease.fencingToken});
  store.db.exec('COMMIT');return true;
 }catch(e){store.db.exec('ROLLBACK');throw e;}
}
export function currentTaskLease(store,id,now=Date.now()){
 const row=store.db.prepare('SELECT owner,fencing_token,expires_at FROM task_leases WHERE task_id=?').get(id);
 return !row||row.expires_at<=now?null:{owner:row.owner,fencingToken:row.fencing_token,expiresAt:row.expires_at};
}
