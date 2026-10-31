import { spawn } from 'node:child_process';
import { realpath, lstat, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const digest=value=>createHash('sha256').update(value).digest('hex');
const safeEnv=()=>({PATH:process.env.PATH??'/usr/bin:/bin',HOME:process.env.HOME??'/tmp',LANG:'C.UTF-8'});
function runControl(binary,args,{timeoutMs=10_000,signal,maxOutputBytes=64*1024}={}) {
  return new Promise((resolveResult,reject)=>{
    let timer,stopped=null,size=0;
    const out=[],err=[];
    const child=spawn(binary,args,{shell:false,detached:process.platform!=='win32',env:safeEnv(),stdio:['ignore','pipe','pipe']});
    const kill=reason=>{
      stopped??=reason;
      if(!child.pid)return;
      try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}
      catch(e){if(e.code!=='ESRCH')child.kill('SIGKILL');}
    };
    const collect=(target,chunk)=>{
      size+=chunk.length;
      if(size>maxOutputBytes){kill('output_limit');return;}
      target.push(chunk);
    };
    const abort=()=>kill(signal?.reason?.message==='timeout'?'timeout':'cancelled');
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    child.stdout.on('data',c=>collect(out,c));
    child.stderr.on('data',c=>collect(err,c));
    child.once('error',e=>{cleanup();reject(e);});
    child.once('close',(code,exitSignal)=>{cleanup();resolveResult({code,signal:exitSignal,reason:stopped,stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8')});});
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    timer=setTimeout(()=>kill('timeout'),timeoutMs);
  });
}
export class DockerSandbox {
  constructor({image='node:24-bookworm-slim',binary='docker',memory='512m',cpus=1,pidsLimit=128,timeoutMs=60_000,maxOutputBytes=65_536}={}) {
    if(typeof image!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}$/.test(image))throw new Error('Invalid sandbox image');
    if(typeof binary!=='string'||!binary||binary.includes('\0'))throw new Error('Invalid Docker binary');
    if(typeof memory!=='string'||!/^[1-9][0-9]*[kmg]$/.test(memory))throw new Error('Invalid memory limit');
    if(typeof cpus!=='number'||!Number.isFinite(cpus)||cpus<=0||cpus>16)throw new Error('Invalid CPU limit');
    if(!Number.isSafeInteger(pidsLimit)||pidsLimit<16||pidsLimit>4096)throw new Error('Invalid PID limit');
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1_000||timeoutMs>900_000)throw new Error('Invalid timeout');
    if(!Number.isSafeInteger(maxOutputBytes)||maxOutputBytes<1||maxOutputBytes>1_048_576)throw new Error('Invalid output limit');
    this.image=image;this.binary=binary;this.memory=memory;this.cpus=cpus;this.pidsLimit=pidsLimit;this.timeoutMs=timeoutMs;this.maxOutputBytes=maxOutputBytes;
  }
  async validateWorkspace(workspace) {
    if(process.platform!=='linux')throw new Error('DockerSandbox v1 currently requires Linux');
    if(typeof workspace!=='string'||!isAbsolute(workspace)||workspace.includes(',')||workspace.includes('\0'))throw new Error('Absolute workspace path required');
    const info=await lstat(workspace);
    if(info.isSymbolicLink())throw new Error('Workspace symlinks are not accepted');
    const path=await realpath(workspace),details=await stat(path);
    if(!details.isDirectory()||path==='/'||path==='/home'||path==='/root')throw new Error('Invalid workspace directory');
    if(typeof process.getuid==='function'&&details.uid!==process.getuid())throw new Error('Workspace must be owned by the current user');
    return path;
  }
  async killContainer(name) {
    await runControl(this.binary,['kill',name],{timeoutMs:5_000}).catch(()=>{});
    await runControl(this.binary,['rm','-f',name],{timeoutMs:5_000}).catch(()=>{});
  }
  async run({workspace,command,taskId='unassigned',toolName='command',signal,timeoutMs=this.timeoutMs,maxOutputBytes=this.maxOutputBytes,assertLease,onRecord=()=>{}}={}) {
    if(typeof assertLease!=='function')throw new Error('Current task lease guard required');
    if(typeof onRecord!=='function')throw new Error('Invalid sandbox audit sink');
    if(!Array.isArray(command)||command.length<1||command.length>128||command.some(x=>typeof x!=='string'||x.includes('\0')||x.length>8192))throw new Error('Command must be a bounded argument array');
    if(typeof toolName!=='string'||!/^[a-zA-Z0-9_.-]{1,64}$/.test(toolName))throw new Error('Invalid tool name');
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1_000||timeoutMs>900_000||!Number.isSafeInteger(maxOutputBytes)||maxOutputBytes<1||maxOutputBytes>1_048_576)throw new Error('Invalid execution limits');
    signal?.throwIfAborted();
    assertLease();
    const root=await this.validateWorkspace(workspace);
    const uid=typeof process.getuid==='function'?process.getuid():1000;
    const gid=typeof process.getgid==='function'?process.getgid():1000;
    const name=`devos-${randomUUID().replaceAll('-','').slice(0,24)}`;
    const policy=[
      '--rm','--name',name,'--network','none','--read-only','--cap-drop','ALL',
      '--security-opt','no-new-privileges:true','--security-opt','seccomp=default','--pids-limit',String(this.pidsLimit),
      '--memory',this.memory,'--memory-swap',this.memory,'--cpus',String(this.cpus),
      '--ulimit','nofile=1024:1024','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=64m',
      '--user',`${uid}:${gid}`,'--workdir','/workspace','--init',
      '--env','HOME=/tmp','--env','PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      '--env','LANG=C.UTF-8','--mount',`type=bind,src=${root},dst=/workspace,rw`,
      '--label','devos.managed=true','--label',`devos.task=${digest(taskId).slice(0,16)}`,
    ];
    const policyHash=digest(JSON.stringify({image:this.image,policy,commandShape:command[0]}));
    const createdAt=Date.now();
    let created;
    try { created=await runControl(this.binary,['create',...policy,this.image,...command],{timeoutMs:15_000,signal}); }
    catch(error) {
      assertLease();
      const output=String(error.message??error);
      const record={tool:'command',command:toolName,exitCode:null,signal:null,reason:'spawn_failed',durationMs:Date.now()-createdAt,outputBytes:Buffer.byteLength(output),outputHash:digest(output)};
      onRecord(structuredClone(record));
      return {...record,policyHash,output:output.slice(0,maxOutputBytes)};
    }
    if(created.reason||created.code!==0){
      await this.killContainer(name);
      assertLease();
      const output=created.stdout+created.stderr;
      const record={tool:'command',command:toolName,exitCode:created.code,signal:created.signal,reason:created.reason??'spawn_failed',durationMs:Date.now()-createdAt,outputBytes:Buffer.byteLength(output),outputHash:digest(output)};
      onRecord(structuredClone(record));
      return {...record,policyHash,output:output.slice(0,maxOutputBytes)};
    }
    const started=createdAt;
    let timer,stopped=null,stopPromise=null,size=0;
    const chunks=[];
    let child;
    const stop=reason=>{
      stopped??=reason;
      if(!stopPromise) {
        if(child?.pid){try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch(e){if(e.code!=='ESRCH')child.kill('SIGKILL');}}
        stopPromise=this.killContainer(name);
      }
    };
    const abort=()=>stop(signal?.reason?.message==='timeout'?'timeout':'cancelled');
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    const outcome=await new Promise((resolveResult,reject)=>{
      child=spawn(this.binary,['start','--attach',name],{shell:false,detached:true,env:safeEnv(),stdio:['ignore','pipe','pipe']});
      child.stdout.on('data',chunk=>{size+=chunk.length;if(size>maxOutputBytes)stop('output_limit');else chunks.push(chunk);});
      child.stderr.on('data',chunk=>{size+=chunk.length;if(size>maxOutputBytes)stop('output_limit');else chunks.push(chunk);});
      child.once('error',error=>{cleanup();stop('spawn_failed');reject(error);});
      child.once('close',async(code,exitSignal)=>{
        cleanup();
        if(stopPromise)await stopPromise;
        resolveResult({code,signal:exitSignal});
      });
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted)abort();
      timer=setTimeout(()=>stop('timeout'),timeoutMs);
    }).catch(error=>({code:null,signal:null,error}));
    const output=Buffer.concat(chunks);
    const reason=stopped??(outcome.error?'spawn_failed':null);
    assertLease();
    const record={tool:'command',command:toolName,exitCode:reason?null:outcome.code,signal:outcome.signal,reason,durationMs:Date.now()-started,outputBytes:size,outputHash:digest(output)};
    const saved=onRecord(structuredClone(record));
    if(saved&&typeof saved.then==='function')throw new Error('Sandbox audit sink must be synchronous');
    return {...record,policyHash,output:output.toString('utf8')};
  }
}
