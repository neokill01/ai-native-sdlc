import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerConfig } from '../providers.js';
import { OpenAIResponsesRuntime } from '../openai-runtime.js';

test('provider selection uses only matching credentials and an explicit model',()=>{
 const config=providerConfig('deepseek',{env:{DEEPSEEK_API_KEY:'test-key',DEVOS_DEEPSEEK_MODEL:'fixture-model',OPENAI_API_KEY:'other-test'}});
 assert.equal(config.apiKey,'test-key');
 assert.equal(config.baseUrl,'https://api.deepseek.com/responses');
 assert.throws(()=>providerConfig('deepseek',{env:{OPENAI_API_KEY:'other-test'},model:'fixture-model'}),/DEEPSEEK_API_KEY/);
 assert.throws(()=>providerConfig('deepseek',{env:{DEEPSEEK_API_KEY:'test-key'}}),/MODEL/);
 assert.throws(()=>providerConfig('unknown',{env:{}}),/Unsupported/);
});

test('DeepSeek Responses request keeps function schemas, reasoning and tool results without forwarding another provider key',async()=>{
 const requests=[];
 const runtime=new OpenAIResponsesRuntime({store:{assertLease(){}},sandbox:{run(){}},
  ...providerConfig('deepseek',{env:{DEEPSEEK_API_KEY:'test-key'},model:'fixture-model'}),
  fetchImpl:async(url,options)=>{
   requests.push({url,...options});
   return new Response(JSON.stringify({output:[],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}));
  }});
 const input=[{type:'reasoning',content:[{type:'reasoning_text',text:'fixture reasoning'}]},
  {type:'function_call',call_id:'call_1',name:'list_files',arguments:'{"path":"."}'},
  {type:'function_call_output',call_id:'call_1',output:'{"entries":[]}'}];
 await runtime.request({model:'fixture-model',input,tools:[{type:'function',name:'list_files',strict:true}],parallel_tool_calls:false,store:false});
 assert.equal(requests[0].url,'https://api.deepseek.com/responses');
 assert.equal(requests[0].headers.Authorization,'Bearer test-key');
 assert.deepEqual(JSON.parse(requests[0].body).input,input);
 assert.throws(()=>new OpenAIResponsesRuntime({store:{assertLease(){}},sandbox:{run(){}},apiKey:'test-key',model:'fixture-model',baseUrl:'https://other.example/responses'}),/HTTPS/);
});
