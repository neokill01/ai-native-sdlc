import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,mkdir,writeFile,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { TaskStore } from '../index.js';
import { GitWorktreeManager } from '../worktrees.js';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'devos-worktree-'));
 const repository=join(root,'repo'),worktreeRoot=join(root,'worktrees');
 await mkdir(repository);
 execFileSync('git',['init',repository],{stdio:'ignore'});
 execFileSync('git',['-C',repository,'config','user.name','DevOS Test']);
 execFileSync('git',['-C',repository,'config','user.email','devos-test@example.invalid']);
 await writeFile(join(repository,'README.md'),'base\n');
 execFileSync('git',['-C',repository,'add','README.md']);
 execFileSync('git',['-C',repository,'commit','-m','initial'],{stdio:'ignore'});
 const store=new TaskStore(':memory:'),task=store.create('worktree task');
 const lease=store.acquireLease(task.id,'worker-test',60_000);
 const manager=new GitWorktreeManager({store,root:worktreeRoot});
 t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 return {root,repository,worktreeRoot,store,task,lease,manager};
}
test('creates a dedicated branch and worktree outside the source repository',async t=>{
 const f=await fixture(t);
 const item=await f.manager.acquire({taskId:f.task.id,lease:f.lease,repository:f.repository});
 assert.equal(item.state,'ready');
 assert.ok(item.branch.includes(`fence-${f.lease.fencingToken}`));
 assert.ok(resolve(item.path).startsWith(resolve(f.worktreeRoot)));
 assert.equal(await readFile(join(item.path,'README.md'),'utf8'),'base\n');
 assert.ok(f.store.events(f.task.id).some(x=>x.type==='worktree.state_changed'));
});
test('reuses a ready worktree instead of creating a second workspace',async t=>{
 const f=await fixture(t);
 const first=await f.manager.acquire({taskId:f.task.id,lease:f.lease,repository:f.repository});
 const second=await f.manager.acquire({taskId:f.task.id,lease:f.lease,repository:f.repository});
 assert.equal(second.path,first.path);
 assert.equal(f.store.listWorktrees(f.task.id,f.lease).length,1);
});
test('dirty worktree is preserved when removal is not forced',async t=>{
 const f=await fixture(t);
 const item=await f.manager.acquire({taskId:f.task.id,lease:f.lease,repository:f.repository});
 await writeFile(join(item.path,'uncommitted.txt'),'keep');
 await assert.rejects(()=>f.manager.remove({taskId:f.task.id,lease:f.lease}),/git worktree remove failed/);
 const recovered=await f.manager.reconcile({taskId:f.task.id,lease:f.lease});
 assert.equal(recovered.state,'ready');
 assert.equal(await readFile(join(item.path,'uncommitted.txt'),'utf8'),'keep');
});
test('stale lease cannot create or mutate a worktree',async t=>{
 const f=await fixture(t);
 const newer=f.store.acquireLease(f.task.id,'worker-new',60_000,Date.now()+60_001);
 await assert.rejects(()=>f.manager.acquire({taskId:f.task.id,lease:f.lease,repository:f.repository}),/lost or expired/);
 const item=await f.manager.acquire({taskId:f.task.id,lease:newer,repository:f.repository});
 assert.equal(item.state,'ready');
});
test('rejects a worktree root nested inside the source repository',async t=>{
 const f=await fixture(t);
 const manager=new GitWorktreeManager({store:f.store,root:join(f.repository,'.devos')});
 await assert.rejects(()=>manager.acquire({taskId:f.task.id,lease:f.lease,repository:f.repository}),/must be separate/);
});
test('reconciles a worktree whose creation completed before its ready event',async t=>{
 const f=await fixture(t);
 const path=join(f.worktreeRoot,`${f.task.id}-${f.lease.fencingToken}`);
 const branch=`devos/tasks/${f.task.id}/fence-${f.lease.fencingToken}`;
 await mkdir(f.worktreeRoot,{recursive:true});
 f.store.reserveWorktree(f.task.id,f.lease,{path,branch,baseRef:'HEAD',repository:f.repository});
 execFileSync('git',['-C',f.repository,'worktree','add','-b',branch,path,'HEAD'],{stdio:'ignore'});
 const item=await f.manager.reconcile({taskId:f.task.id,lease:f.lease});
 assert.equal(item.state,'ready');
});
