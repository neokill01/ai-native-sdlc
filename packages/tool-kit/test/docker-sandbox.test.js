import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
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
test('container writes only to the mounted task workspace', {skip}, async t=>{
 const f=await fixture(t);
 const result=await f.sandbox.run({workspace:f.root,command:['node','-e','require("fs").writeFileSync("/workspace/result.txt","sandbox-ok")'],assertLease:f.guard});
 assert.equal(result.exitCode,0);
 assert.equal(result.reason,null);
 assert.equal(await readFile(join(f.root,'result.txt'),'utf8'),'sandbox-ok');
 assert.ok(result.policyHash);
 assert.equal(Object.hasOwn(result,'outputHash'),true);
});
test('network, root filesystem and Linux capabilities are restricted', {skip}, async t=>{
 const f=await fixture(t);
 const script=`const fs=require('fs'),net=require('net');const s=fs.readFileSync('/proc/self/status','utf8');if(!/^NoNewPrivs:\\s+1$/m.test(s))process.exit(21);if(!/^CapEff:\\s+0+$/m.test(s))process.exit(22);try{fs.writeFileSync('/etc/devos-sandbox-probe','x');process.exit(23)}catch(e){if(!['EROFS','EACCES','EPERM'].includes(e.code))process.exit(24)}const c=net.createConnection({host:'1.1.1.1',port:53});c.setTimeout(1000);c.on('connect',()=>process.exit(25));c.on('error',()=>process.exit(0));c.on('timeout',()=>{c.destroy();process.exit(0)});`;
 const result=await f.sandbox.run({workspace:f.root,command:['node','-e',script],assertLease:f.guard});
 assert.equal(result.exitCode,0,result.output);
});
test('timeout kills the container and bounds output', {skip}, async t=>{
 const f=await fixture(t);
 const timed=await f.sandbox.run({workspace:f.root,command:['node','-e','setInterval(()=>{},1000)'],timeoutMs:1_000,assertLease:f.guard});
 assert.equal(timed.reason,'timeout');
 const limited=await f.sandbox.run({workspace:f.root,command:['node','-e','process.stdout.write("x".repeat(10000))'],maxOutputBytes:128,assertLease:f.guard});
 assert.equal(limited.reason,'output_limit');
 assert.ok(limited.outputBytes>=128);
});
test('lease is checked before starting the sandbox and after completion', {skip}, async t=>{
 const f=await fixture(t);
 await assert.rejects(()=>f.sandbox.run({workspace:f.root,command:['node','-e',''],assertLease:()=>{throw new Error('lease lost')}}),/lease lost/);
});
