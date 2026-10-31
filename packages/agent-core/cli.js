#!/usr/bin/env node
import { readFile, mkdir, chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TaskStore, runTask, OpenAIResponsesRuntime, ApprovedPlanEvaluator } from './index.js';
import { GitWorktreeManager } from './worktrees.js';
import { DockerSandbox } from '../tool-kit/docker-sandbox.js';

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {}, positional = [];
  for (let i=0;i<rest.length;i++) {
    const token=rest[i];
    if (!token.startsWith('--')) { positional.push(token); continue; }
    const key=token.slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
    if (!key || Object.hasOwn(options,key)) throw new Error(`Duplicate or invalid option: ${token}`);
    if (i+1<rest.length&&!rest[i+1].startsWith('--')) options[key]=rest[++i];
    else options[key]=true;
  }
  return {command,options,positional};
}
const required=(options,key)=>{const value=options[key];if(typeof value!=='string'||!value.trim())throw new Error(`--${key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())} is required`);return value;};
const number=(options,key,fallback,min=0,max=Number.MAX_SAFE_INTEGER)=>{
  const raw=options[key];if(raw===undefined)return fallback;
  const value=Number(raw);if(!Number.isFinite(value)||value<min||value>max)throw new Error(`Invalid --${key}`);
  return value;
};
async function withStore(options,fn) {
  const db=resolve(required(options,'db'));
  await mkdir(dirname(db),{recursive:true,mode:0o700});
  const store=new TaskStore(db);
  try { await chmod(db,0o600); return await fn(store); }
  finally { store.close(); }
}
const json=value=>process.stdout.write(JSON.stringify(value,null,2)+'\n');
function help() {
  process.stdout.write(`Agentic DevOS CLI

Commands:
  create --db PATH --title TEXT
  artifact --db PATH --task ID --kind intent|spec|plan --file PATH
  approve --db PATH --task ID --actor ACTOR
  status --db PATH --task ID
  report --db PATH --task ID
  resolve --db PATH --task ID --actor ACTOR --decision completed|not_executed (--evidence TEXT | --evidence-file PATH)
  run --db PATH --task ID --repository PATH --worktree-root PATH [--model MODEL] [--max-total-tokens N] [--max-cost-usd USD]

Run requires OPENAI_API_KEY and DEVOS_OPENAI_MODEL (or --model). API credentials are read only by the host process and are never passed into the sandbox.
`);
}
const allowedOptions = {
  create: ['db','title'],
  artifact: ['db','task','kind','file'],
  approve: ['db','task','actor'],
  status: ['db','task'],
  report: ['db','task'],
  resolve: ['db','task','actor','decision','evidence','evidenceFile'],
  run: ['db','task','repository','worktreeRoot','model','baseRef','workerId','timeoutMs','maxTotalTokens','maxCostUsd','inputUsdPerMillion','outputUsdPerMillion','image','memory','cpus','pidsLimit','commandTimeoutMs','maxOutputBytes','maxTurns','maxToolCalls','maxOutputTokens','requestTimeoutMs'],
};
export async function main(argv=process.argv.slice(2)) {
  const {command,options,positional}=parseArgs(argv);
  if(!command||command==='help'||options.help){help();return 0;}
  if(positional.length)throw new Error('Unexpected positional arguments');
  if(!allowedOptions[command])throw new Error(`Unknown command: ${command}`);
  for(const key of Object.keys(options))if(!allowedOptions[command].includes(key))throw new Error(`Unknown option --${key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}`);
  if(command==='resolve'&&Boolean(options.evidence)===Boolean(options.evidenceFile))throw new Error('Provide exactly one of --evidence or --evidence-file');
  if(command==='create')return withStore(options,store=>{
    const task=store.create(required(options,'title'));
    json({id:task.id,status:task.status,version:task.version});
    return 0;
  });
  if(command==='artifact')return withStore(options,async store=>{
    const id=required(options,'task'),kind=required(options,'kind'),file=resolve(required(options,'file'));
    const task=store.get(id);
    let updated=store.artifact(id,task.version,kind,await readFile(file,'utf8'));
    if(updated.status==='created'&&kind==='intent')updated=store.transition(id,updated.version,'intent_review');
    json({id:updated.id,status:updated.status,version:updated.version,artifact:kind});
    return 0;
  });
  if(command==='approve')return withStore(options,store=>{
    const id=required(options,'task'),actor=required(options,'actor');
    const task=store.get(id);
    const next={intent_review:'spec_review',spec_review:'plan_review',plan_review:'queued'}[task.status];
    if(!next)throw new Error('Task is not awaiting an approval');
    const approved=store.approve(id,task.version,actor);
    const updated=store.transition(id,approved.version,next);
    json({id:updated.id,status:updated.status,version:updated.version,approvedBy:actor});
    return 0;
  });
  if(command==='status')return withStore(options,store=>{
    const id=required(options,'task'),task=store.get(id);
    json({id:task.id,title:task.title,status:task.status,version:task.version,repairs:task.repairs,maxRepairs:task.maxRepairs,verification:task.verification,stopReason:task.stopReason??null,worktrees:store.worktreeHistory(id)});
    return 0;
  });
  if(command==='report')return withStore(options,store=>{
    const id=required(options,'task');
    json(store.report(id));
    return 0;
  });
  if(command==='resolve')return withStore(options,async store=>{
    const id=required(options,'task'),actor=required(options,'actor'),decision=required(options,'decision');
    const evidence=options.evidenceFile?await readFile(resolve(options.evidenceFile),'utf8'):required(options,'evidence');
    const task=store.get(id);
    const updated=store.resolvePending(id,task.version,{actor,decision,evidence});
    json({id:updated.id,status:updated.status,version:updated.version,resolution:updated.checkpoint.resolution});
    return 0;
  });
  if(command==='run')return withStore(options,async store=>{
    const id=required(options,'task');
    const repository=resolve(required(options,'repository'));
    const worktreeRoot=resolve(required(options,'worktreeRoot'));
    const model=options.model??process.env.DEVOS_OPENAI_MODEL;
    if(typeof model!=='string'||!model.trim())throw new Error('DEVOS_OPENAI_MODEL or --model is required');
    const timeoutMs=number(options,'timeoutMs',900_000,1_000,3_570_000);
    const maxTotalTokens=number(options,'maxTotalTokens',100_000,16,10_000_000);
    const maxCostUsd=options.maxCostUsd===undefined?null:number(options,'maxCostUsd',null,0.001,1000);
    const inputRate=options.inputUsdPerMillion===undefined?null:number(options,'inputUsdPerMillion',null,0,100_000);
    const outputRate=options.outputUsdPerMillion===undefined?null:number(options,'outputUsdPerMillion',null,0,100_000);
    const pricing=maxCostUsd===null?null:{inputUsdPerMillion:inputRate,outputUsdPerMillion:outputRate};
    if(maxCostUsd!==null&&(inputRate===null||outputRate===null))throw new Error('A cost cap requires --input-usd-per-million and --output-usd-per-million');
    const sandbox=new DockerSandbox({image:options.image??'node:24-bookworm-slim',memory:options.memory??'512m',cpus:number(options,'cpus',1,0.1,16),pidsLimit:number(options,'pidsLimit',128,16,4096),timeoutMs:number(options,'commandTimeoutMs',60_000,1_000,900_000),maxOutputBytes:number(options,'maxOutputBytes',65_536,1,1_048_576)});
    const worktreeManager=new GitWorktreeManager({store,root:worktreeRoot});
    const runtime=new OpenAIResponsesRuntime({store,sandbox,model,maxTurns:number(options,'maxTurns',20,1,100),maxToolCalls:number(options,'maxToolCalls',40,1,500),maxOutputTokens:number(options,'maxOutputTokens',4_000,16,32_000),maxTotalTokens,maxCostUsd,pricing,requestTimeoutMs:number(options,'requestTimeoutMs',90_000,1_000,600_000)});
    const evaluator=new ApprovedPlanEvaluator({store,sandbox});
    const task=await runTask(store,id,{runtime,evaluator,worktreeManager,repository,baseRef:options.baseRef??'HEAD',timeoutMs,leaseTtlMs:Math.min(3_600_000,timeoutMs+60_000),workerId:options.workerId??`cli-${process.pid}`});
    const report=store.report(id);
    json({taskId:id,status:task.status,stopReason:task.stopReason??null,verification:task.verification,reportId:report.id,reportStatus:report.status,checks:report.checks,acceptance:report.acceptance});
    return task.status==='completed'?0:1;
  });
  throw new Error(`Unknown command: ${command}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code=>{process.exitCode=code;}).catch(error=>{
    process.stderr.write(`devos: ${String(error.message??error).slice(0,1000)}\n`);
    process.exitCode=1;
  });
}
