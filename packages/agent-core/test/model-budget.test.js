import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskStore } from '../index.js';
import { taskBudget } from '../model-budget.js';
const policy={model:'fixture-model',maxTotalTokens:1000,maxCostUsd:0.00015,pricing:{inputUsdPerMillion:1,outputUsdPerMillion:1},maxTurns:3,maxToolCalls:2};

test('reopened database retains cost, tool and turn usage and immutable policy',t=>{
 const dir=mkdtempSync(join(tmpdir(),'devos-budget-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const filename=join(dir,'task.db');
 const store=new TaskStore(filename),task=store.create('budget fixture'),lease=store.acquireLease(task.id,'budget-worker',60_000);
 const first=taskBudget(store,task.id,lease,policy),id=first.beforeRequest();
 first.charge(id,{inputTokens:100,outputTokens:50,totalTokens:150});
 store.event(task.id,'model.tool_call',{name:'fixture'});
 store.close();
 const reopened=new TaskStore(filename);
 try{
  const next=taskBudget(reopened,task.id,lease,policy);
  assert.equal(next.usage.totalTokens,150);
  assert.equal(next.toolCalls,1);
  assert.throws(()=>next.beforeRequest(),/budget exceeded/);
  const report=reopened.report(task.id);
  assert.equal(report.modelUsage.totalTokens,150);
  assert.equal(report.modelUsage.uncertainRequests,0);
  assert.throws(()=>taskBudget(reopened,task.id,lease,{...policy,maxCostUsd:10}),/policy cannot change/);
 }finally{reopened.close();}
});

test('turn and tool allowances are cumulative rather than per execution',t=>{
 const store=new TaskStore(':memory:');t.after(()=>store.close());
 const task=store.create('allowance fixture'),lease=store.acquireLease(task.id,'budget-worker',60_000);
 const p={...policy,maxCostUsd:null,maxTurns:1,maxToolCalls:1};
 const first=taskBudget(store,task.id,lease,p);
 first.charge(first.beforeRequest(),{inputTokens:1,outputTokens:1,totalTokens:2});
 store.event(task.id,'model.tool_call',{name:'fixture'});
 const next=taskBudget(store,task.id,lease,p);
 assert.throws(()=>next.beforeRequest(),/turn budget exhausted/);
 assert.throws(()=>next.allowTools(1),/tool-call budget exceeded/);
});
