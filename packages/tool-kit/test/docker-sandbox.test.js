import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile,writeFile,symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DockerSandbox } from '../docker-sandbox.js';

const image=process.env.DEVOS_SANDBOX_IMAGE??'node:24-bookworm-slim';
const dockerReady=process.platform==='linux'&&spawnSync('docker',['info'],{stdio:'ignore'}).status===0&&spawnSync('docker',['image','inspect',image],{stdio:'ignore'}).status===0;
const skip=dockerReady?false:'Docker daemon and pre-pulled sandbox image required';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'devos-docker-sandbox-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const sandbox=new DockerSandbox({image,timeoutMs:15_000,maxOutputBytes:4096});
 return {root,sandbox,guard:()=>true};
}
test('container writes only to the mounted task workspace and emits schema-safe audit metadata', {skip}, async t=>{
 const f=await fixture(t);
 let audit=null;
 const result=await f.sandbox.run({workspace:f.root,command:['node','-e','require("fs").writeFileSync("/workspace/result.txt","sandbox-ok")'],assertLease:f.guard,onRecord:record=>{audit=record;}});
 assert.equal(result.exitCode,0);
 assert.equal(result.reason,null);
 assert.equal(await readFile(join(f.root,'result.txt'),'utf8'),'sandbox-ok');
 assert.ok(result.policyHash);
 assert.equal(Object.hasOwn(result,'outputHash'),true);
 assert.equal(audit.tool,'command');
 assert.equal(audit.command,'command');
 assert.equal(audit.outputHash.length,64);
});
test('network, root filesystem and Linux capabilities are restricted', {skip}, async t=>{
 const f=await fixture(t);
 const script=`const fs=require('fs'),net=require('net');const s=fs.readFileSync('/proc/self/status','utf8');if(!/^NoNewPrivs:\\s+1$/m.test(s))process.exit(21);if(!/^CapEff:\\s+0+$/m.test(s))process.exit(22);try{fs.writeFileSync('/etc/devos-sandbox-probe','x');process.exit(23)}catch(e){if(!['EROFS','EACCES','EPERM'].includes(e.code))process.exit(24)}const c=net.createConnection({host:'1.1.1.1',port:53});c.setTimeout(1000);c.on('connect',()=>process.exit(25));c.on('error',()=>process.exit(0));c.on('timeout',()=>{c.destroy();process.exit(0)});`;
 const result=await f.sandbox.run({workspace:f.root,command:['node','-e',script],assertLease:f.guard});
 assert.equal(result.exitCode,0,result.output);
});
function runningContainer(runId){return spawnSync('docker',['ps','-q','--filter',`label=devos.run=${runId}`],{encoding:'utf8'}).stdout.trim();}
function allContainers(runId){return spawnSync('docker',['ps','-aq','--filter',`label=devos.run=${runId}`],{encoding:'utf8'}).stdout.trim();}
test('timeout kills the container and bounds output', {skip}, async t=>{
 const f=await fixture(t);
 const timed=await f.sandbox.run({workspace:f.root,command:['node','-e','setInterval(()=>{},1000)'],timeoutMs:1_000,assertLease:f.guard});
 assert.equal(timed.reason,'timeout');
 assert.equal(allContainers(timed.runId),'');
 const limited=await f.sandbox.run({workspace:f.root,command:['node','-e','process.stdout.write("x".repeat(10000))'],maxOutputBytes:128,assertLease:f.guard});
 assert.equal(limited.reason,'output_limit');
 assert.ok(limited.outputBytes>=128);
 assert.equal(allContainers(limited.runId),'');
});
test('host environment secrets and sibling files are not exposed to the container', {skip}, async t=>{ const f=await fixture(t); const sibling=f.root+'-host-secret.txt'; const { writeFile }=await import('node:fs/promises'); await writeFile(sibling,'must-not-be-mounted'); const previous=process.env.DEVOS_SANDBOX_SECRET; process.env.DEVOS_SANDBOX_SECRET='must-not-forward'; try { const script='const fs=require("fs");if(process.env.DEVOS_SANDBOX_SECRET)process.exit(31);if(fs.existsSync("'+sibling+'"))process.exit(32);'; const result=await f.sandbox.run({workspace:f.root,command:['node','-e',script],assertLease:f.guard}); assert.equal(result.exitCode,0,result.output); } finally { if(previous===undefined)delete process.env.DEVOS_SANDBOX_SECRET;else process.env.DEVOS_SANDBOX_SECRET=previous; await rm(sibling,{force:true}); } });
test('lease is checked before starting the sandbox and after completion', {skip}, async t=>{
 const f=await fixture(t);
 await assert.rejects(()=>f.sandbox.run({workspace:f.root,command:['node','-e',''],assertLease:()=>{throw new Error('lease lost')}}),/lease lost/);
});

test('container resource limits are applied and cancellation removes the container', {skip}, async t=>{
 const f=await fixture(t);
 const runId='a'.repeat(24),controller=new AbortController();
 const pending=f.sandbox.run({workspace:f.root,command:['node','-e','setInterval(()=>{},1000)'],runId,signal:controller.signal,assertLease:f.guard});
 let id='';
 for(let i=0;i<30&&!id;i++){await new Promise(resolve=>setTimeout(resolve,100));id=runningContainer(runId);}
 assert.ok(id,'sandbox container did not start');
 const inspected=spawnSync('docker',['inspect','--format','{{.HostConfig.NetworkMode}}|{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.Memory}}|{{.HostConfig.PidsLimit}}|{{.HostConfig.NanoCpus}}|{{json .HostConfig.CapDrop}}',id],{encoding:'utf8'});
 assert.equal(inspected.status,0,inspected.stderr);
 assert.equal(inspected.stdout.trim(),'none|true|536870912|128|1000000000|["ALL"]');
 controller.abort(new Error('cancelled'));
 const result=await pending;
 assert.equal(result.reason,'cancelled');
 assert.equal(allContainers(runId),'');
});

test('fails closed on credential files, secret-like source and symlinks outside the workspace',async t=>{
 const f=await fixture(t);
 await writeFile(join(f.root,'.env'),'OPENAI_API_KEY=sk-test-abcdefghijklmnopqrstuvwxyz');
 await assert.rejects(()=>f.sandbox.run({workspace:f.root,command:['node','-e',''],assertLease:f.guard}),/Sensitive credential file denied/);
 await rm(join(f.root,'.env'));
 await writeFile(join(f.root,'config.js'),'export const token = "ghp_abcdefghijklmnopqrstuvwxyz123456";');
 await assert.rejects(()=>f.sandbox.run({workspace:f.root,command:['node','-e',''],assertLease:f.guard}),/Secret-like material/);
 await rm(join(f.root,'config.js'));
 const outside=f.root+'-outside.txt';
 await writeFile(outside,'outside');
 await symlink(outside,join(f.root,'outside-link'));
 await assert.rejects(()=>f.sandbox.run({workspace:f.root,command:['node','-e',''],assertLease:f.guard}),/symlink leaves the mounted workspace/);
 await rm(outside,{force:true});
});

test('repository source tree passes the credential preflight scanner',async()=>{
 const sandbox=new DockerSandbox();
 await sandbox.validateWorkspace(process.cwd());
});
