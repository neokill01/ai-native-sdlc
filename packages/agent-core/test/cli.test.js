import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { TaskStore,runTask } from '../index.js';

const cli=resolve('packages/agent-core/cli.js');
function call(args,env=process.env){
 const result=spawnSync(process.execPath,[cli,...args],{encoding:'utf8',env:{...env}});
 return {...result,json:()=>JSON.parse(result.stdout)};
}
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'devos-cli-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 return {root,db:join(root,'tasks.sqlite')};
}
test('CLI creates, reviews, queues and reports a task with explicit approvals',async t=>{
 const f=await fixture(t);
 const created=call(['create','--db',f.db,'--title','CLI smoke task']);
 assert.equal(created.status,0,created.stderr);
 const id=created.json().id;
 const intent=join(f.root,'intent.md'),spec=join(f.root,'spec.md'),plan=join(f.root,'plan.json');
 await writeFile(intent,'Add a small feature.');
 await writeFile(spec,'Export a named constant.');
 await writeFile(plan,JSON.stringify({verification:{commands:[{name:'unit',command:['node','-e','process.exit(0)']}]}}));
 assert.equal(call(['artifact','--db',f.db,'--task',id,'--kind','intent','--file',intent]).json().status,'intent_review');
 assert.equal(call(['approve','--db',f.db,'--task',id]).json().status,'spec_review');
 assert.equal(call(['artifact','--db',f.db,'--task',id,'--kind','spec','--file',spec]).json().status,'spec_review');
 assert.equal(call(['approve','--db',f.db,'--task',id]).json().status,'plan_review');
 assert.equal(call(['artifact','--db',f.db,'--task',id,'--kind','plan','--file',plan]).json().status,'plan_review');
 assert.equal(call(['approve','--db',f.db,'--task',id]).json().status,'queued');
 const status=call(['status','--db',f.db,'--task',id]).json();
 assert.equal(status.status,'queued');
 const report=call(['report','--db',f.db,'--task',id]).json();
 assert.equal(report.acceptance,'needs_human_review');
});
test('CLI manual resolution resumes a paused uncertain operation with hashed evidence',async t=>{
 const f=await fixture(t);
 const store=new TaskStore(f.db);
 let task=store.create('manual recovery');
 task=store.artifact(task.id,task.version,'intent','test intent');
 task=store.transition(task.id,task.version,'intent_review');
 task=store.approve(task.id,task.version,'operator');
 task=store.transition(task.id,task.version,'spec_review');
 task=store.artifact(task.id,task.version,'spec','test spec');
 task=store.approve(task.id,task.version,'operator');
 task=store.transition(task.id,task.version,'plan_review');
 task=store.artifact(task.id,task.version,'plan',JSON.stringify({verification:{commands:[{name:'unit',command:['node','-e','true']}]}}));
 task=store.approve(task.id,task.version,'operator');
 task=store.transition(task.id,task.version,'queued');
 const lease=store.acquireLease(task.id,'prepare-pending',60_000);
 task=store.transition(task.id,task.version,'running',null,lease);
 task=store.checkpoint(task.id,task.version,{operation:'pending',operationKey:`${task.id}:0`},lease);
 store.releaseLease(task.id,lease);
 await runTask(store,task.id,{runtime:{execute:async()=>{}},evaluator:{verify:async()=>({verdict:'passed',evidence:'unused'})}});
 assert.equal(store.get(task.id).status,'paused');
 store.close();
 const resolved=call(['resolve','--db',f.db,'--task',task.id,'--decision','completed','--evidence','external job verified complete']);
 assert.equal(resolved.status,0,resolved.stderr);
 assert.equal(resolved.json().status,'queued');
 assert.ok(resolved.json().resolution.evidenceHash);
});
test('CLI never accepts API credentials as command-line arguments and fails closed without env key',async t=>{
 const f=await fixture(t);
 const created=call(['create','--db',f.db,'--title','no key']);
 const id=created.json().id;
 const result=call(['run','--db',f.db,'--task',id,'--repository',f.root,'--worktree-root',join(f.root,'worktrees'),'--model','gpt-6-astra','--api-key','secret'],{...process.env,OPENAI_API_KEY:''});
 assert.notEqual(result.status,0);
 assert.match(result.stderr,/Unknown option --api-key/);
 assert.ok(!result.stderr.includes('secret'));
});
