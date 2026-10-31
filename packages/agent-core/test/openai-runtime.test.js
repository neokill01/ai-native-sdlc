import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore, runTask } from '../index.js';
import { OpenAIResponsesRuntime, ApprovedPlanEvaluator } from '../openai-runtime.js';

function queue(store,planContent=JSON.stringify({verification:{commands:[{name:'unit',command:['node','-e','process.exit(0)']}]}})){
 let task=store.create('Add a small tested module');
 task=store.artifact(task.id,task.version,'intent','Add src/value.js exporting value 42.');
 task=store.transition(task.id,task.version,'intent_review');
 task=store.approve(task.id,task.version,'reviewer');
 task=store.transition(task.id,task.version,'spec_review');
 task=store.artifact(task.id,task.version,'spec','Export a named constant value.');
 task=store.approve(task.id,task.version,'reviewer');
 task=store.transition(task.id,task.version,'plan_review');
 task=store.artifact(task.id,task.version,'plan',planContent);
 task=store.approve(task.id,task.version,'reviewer');
 return store.transition(task.id,task.version,'queued');
}
function response(output,usage={input_tokens:100,output_tokens:50,total_tokens:150}){
 return new Response(JSON.stringify({id:'resp_test',status:'completed',output,usage}),{status:200,headers:{'content-type':'application/json','x-request-id':'req_test'}});
}
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'devos-openai-runtime-'));
 const store=new TaskStore(':memory:');
 t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 return {root,store};
}
test('Responses runtime executes model tool calls in sequence and evaluates the approved plan',async t=>{
 const f=await fixture(t),task=queue(f.store);
 const requests=[];
 let sandboxCalls=0;
 const sandbox={run:async({command,toolName,assertLease,onRecord})=>{
   assertLease();sandboxCalls++;
   const record={tool:'command',command:toolName,exitCode:0,signal:null,reason:null,durationMs:4,outputBytes:2,outputHash:'a'.repeat(64)};
   onRecord(record);
   return {exitCode:0,reason:null,output:'ok',outputHash:record.outputHash};
 }};
 const responses=[
  response([{type:'function_call',call_id:'call_write',name:'write_file',arguments:JSON.stringify({path:'src/value.js',content:'export const value = 42;\n'})}]),
  response([{type:'function_call',call_id:'call_test',name:'run_command',arguments:JSON.stringify({command:['node','-e','process.exit(0)'],tool_name:'quick_test',timeout_ms:5000})}]),
  response([{type:'message',role:'assistant',content:[{type:'output_text',text:'Implemented src/value.js and verified it.'}]}]),
 ];
 const fetchImpl=async(url,options)=>{requests.push({url,options,body:JSON.parse(options.body)});return responses.shift();};
 const runtime=new OpenAIResponsesRuntime({store:f.store,sandbox,apiKey:'test-api-secret',model:'gpt-6-astra',fetchImpl});
 const evaluator=new ApprovedPlanEvaluator({store:f.store,sandbox});
 const completed=await runTask(f.store,task.id,{runtime,evaluator});
 assert.equal(completed.status,'completed');
 assert.equal(await readFile(join(f.root,'src/value.js'),'utf8'),'export const value = 42;\n');
 assert.equal(sandboxCalls,2);
 assert.equal(requests.length,3);
 assert.equal(requests[0].body.store,false);
 assert.equal(requests[0].options.headers.Authorization,'Bearer test-api-secret');
 assert.ok(requests[0].body.tools.every(x=>x.strict===true));
 assert.ok(requests[1].body.input.some(x=>x.type==='function_call'&&x.call_id==='call_write'));
 assert.ok(requests[1].body.input.some(x=>x.type==='function_call_output'&&x.call_id==='call_write'));
 assert.ok(f.store.events(task.id).some(x=>x.type==='model.usage'));
 assert.ok(!JSON.stringify(f.store.events(task.id)).includes('test-api-secret'));
});
test('runtime refuses to start without an API key or explicit model',async t=>{
 const f=await fixture(t);
 assert.throws(()=>new OpenAIResponsesRuntime({store:f.store,sandbox:{run:async()=>{}},apiKey:'',model:'gpt-6-astra'}),/OPENAI_API_KEY/);
 assert.throws(()=>new OpenAIResponsesRuntime({store:f.store,sandbox:{run:async()=>{}},apiKey:'x',model:''}),/DEVOS_OPENAI_MODEL/);
});
test('token budget stops before executing model-proposed tools',async t=>{
 const f=await fixture(t),task=queue(f.store);
 const sandbox={run:async()=>{throw new Error('must not execute');}};
 const runtime=new OpenAIResponsesRuntime({store:f.store,sandbox,apiKey:'test',model:'gpt-6-astra',maxTotalTokens:50,
   fetchImpl:async()=>response([{type:'function_call',call_id:'call_write',name:'write_file',arguments:JSON.stringify({path:'src/no.js',content:'x'})}],{input_tokens:40,output_tokens:20,total_tokens:60})});
 const lease=f.store.acquireLease(task.id,'budget-test',60_000);
 const running=f.store.transition(task.id,task.version,'running',null,lease);
 await assert.rejects(()=>runtime.execute({task:running,workspace:f.root,lease}),/budget exceeded/);
 await assert.rejects(()=>readFile(join(f.root,'src/no.js'),'utf8'));
 f.store.releaseLease(task.id,lease);
});
test('approved evaluator rejects missing or stale plan approval',async t=>{
 const f=await fixture(t),task=queue(f.store);
 const lease=f.store.acquireLease(task.id,'eval-test',60_000);
 const running=f.store.transition(task.id,task.version,'running',null,lease);
 const verifying=f.store.transition(running.id,running.version,'verifying',null,lease);
 const invalid={...verifying,approvals:{...verifying.approvals,plan:{hash:'0'.repeat(64)}}};
 const evaluator=new ApprovedPlanEvaluator({store:f.store,sandbox:{run:async()=>{throw new Error('must not run');}}});
 const result=await evaluator.verify({task:invalid,workspace:f.root,lease});
 assert.equal(result.verdict,'failed');
 assert.match(result.evidence,/Approved plan hash/);
 f.store.releaseTaskLease?.(task.id,lease);
 f.store.releaseLease(task.id,lease);
});
