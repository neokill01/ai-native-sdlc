import { spawn } from 'node:child_process';
import { mkdir, realpath, lstat } from 'node:fs/promises';
import { resolve, relative, sep, isAbsolute } from 'node:path';

const states = new Set(['creating','ready','removing','removed','failed','orphaned','missing']);
const within = (base,target) => {
  const rel=relative(base,target);
  return rel==='' || (rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel));
};
function runGit(cwd,args,{timeoutMs=15_000,signal,maxOutputBytes=256*1024}={}) {
  return new Promise((resolveResult,reject)=>{
    let timer, stopped=null, bytes=0;
    const out=[],err=[];
    const child=spawn('git',args,{cwd,shell:false,detached:process.platform!=='win32',
      env:{PATH:process.env.PATH??'/usr/bin:/bin',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null'},
      stdio:['ignore','pipe','pipe']});
    const kill=reason=>{
      stopped??=reason;
      if(!child.pid)return;
      try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}
      catch(e){if(e.code!=='ESRCH')child.kill('SIGKILL');}
    };
    const collect=(target,chunk)=>{
      bytes+=chunk.length;
      if(bytes>maxOutputBytes){kill('output_limit');return;}
      target.push(chunk);
    };
    const abort=()=>kill('cancelled');
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
    child.stdout.on('data',c=>collect(out,c));
    child.stderr.on('data',c=>collect(err,c));
    child.once('error',e=>{cleanup();reject(e);});
    child.once('close',(code,exitSignal)=>{
      cleanup();
      if(stopped) return reject(new Error(`git operation ${stopped}`));
      if(code!==0)return reject(new Error(`git ${args[0]} failed (${code??exitSignal}): ${Buffer.concat(err).toString('utf8').slice(0,2048)}`));
      resolveResult(Buffer.concat(out).toString('utf8').trim());
    });
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    timer=setTimeout(()=>kill('timeout'),timeoutMs);
  });
}
function parseWorktrees(text) {
  const entries=[];
  let item=null;
  for(const line of text.split('\n')){
    if(line.startsWith('worktree ')){if(item)entries.push(item);item={path:line.slice(9)};}
    else if(item&&line.startsWith('HEAD '))item.head=line.slice(5);
    else if(item&&line.startsWith('branch '))item.branch=line.slice(7).replace(/^refs\/heads\//,'');
    else if(item&&line==='detached')item.branch=null;
  }
  if(item)entries.push(item);
  return entries;
}
export class GitWorktreeManager {
  constructor({store,root,timeoutMs=15_000}={}) {
    if(!store?.assertLease||!store?.reserveWorktree||!store?.updateWorktree||!store?.getWorktree||!store?.listWorktrees)throw new Error('Worktree store required');
    if(typeof root!=='string'||!isAbsolute(root))throw new Error('Absolute worktree root required');
    if(!Number.isSafeInteger(timeoutMs)||timeoutMs<=0)throw new Error('Invalid git timeout');
    this.store=store;this.root=resolve(root);this.timeoutMs=timeoutMs;
  }
  async repositoryRoot(repository) {
    const requested=await realpath(repository);
    const top=await runGit(requested,['rev-parse','--show-toplevel'],{timeoutMs:this.timeoutMs});
    const actual=await realpath(top);
    if(actual!==requested)throw new Error('Repository path must be the Git worktree root');
    return actual;
  }
  async prepareRoot(repository) {
    await mkdir(this.root,{recursive:true});
    const root=await realpath(this.root);
    if(within(repository,root)||within(root,repository))throw new Error('Worktree root and repository must be separate');
    return root;
  }
  async acquire({taskId,lease,repository,baseRef='HEAD',signal}={}) {
    this.store.assertLease(taskId,lease);
    if(!/^[a-zA-Z0-9-]{1,64}$/.test(taskId))throw new Error('Invalid task id for worktree');
    if(typeof baseRef!=='string'||!baseRef||baseRef.startsWith('-')||/[\s\0~^:?*\[\\]/.test(baseRef)||baseRef.includes('..')||baseRef.includes('@{'))throw new Error('Invalid base ref');
    const repo=await this.repositoryRoot(repository);
    const root=await this.prepareRoot(repo);
    await runGit(repo,['rev-parse','--verify',`${baseRef}^{commit}`],{timeoutMs:this.timeoutMs,signal});
    const existing=this.store.listWorktrees(taskId,lease).sort((a,b)=>b.fencing_token-a.fencing_token);
    for(const item of existing){
      if(item.state==='ready'||item.state==='creating'||item.state==='removing'){
        const recovered=await this.reconcile({taskId,lease,fencingToken:item.fencing_token,signal});
        if(recovered.state==='ready')return recovered;
        if(recovered.state==='orphaned'||recovered.state==='missing')throw new Error('Existing worktree needs manual reconciliation');
      }
    }
    const branch=`devos/tasks/${taskId}/fence-${lease.fencingToken}`;
    await runGit(repo,['check-ref-format','--branch',branch],{timeoutMs:this.timeoutMs,signal});
    const path=resolve(root,`${taskId}-${lease.fencingToken}`);
    try{await lstat(path);throw new Error('Worktree path already exists');}
    catch(e){if(e.code!=='ENOENT')throw e;}
    this.store.reserveWorktree(taskId,lease,{path,branch,baseRef,repository:repo});
    try{
      await runGit(repo,['worktree','add','-b',branch,path,baseRef],{timeoutMs:this.timeoutMs,signal});
      const head=await runGit(path,['rev-parse','HEAD'],{timeoutMs:this.timeoutMs,signal});
      return this.store.updateWorktree(taskId,lease,lease.fencingToken,'ready',head);
    }catch(error){
      try{this.store.updateWorktree(taskId,lease,lease.fencingToken,'failed');}catch{/* stale worker cannot rewrite reconciliation state */}
      throw error;
    }
  }
  async reconcile({taskId,lease,fencingToken=lease?.fencingToken,signal}={}) {
    this.store.assertLease(taskId,lease);
    const item=this.store.getWorktree(taskId,lease,fencingToken);
    const list=parseWorktrees(await runGit(item.repository,['worktree','list','--porcelain'],{timeoutMs:this.timeoutMs,signal}));
    const found=list.find(x=>resolve(x.path)===resolve(item.path));
    let state=item.state,head=item.head_sha??null;
    if(found){
      if(found.branch!==item.branch){state='orphaned';}
      else if(state==='creating'||state==='removing'||state==='missing')state='ready';
      head=found.head??head;
    }else{
      try{await lstat(item.path);state='orphaned';}
      catch(e){if(e.code!=='ENOENT')throw e;state=state==='removing'?'removed':state==='removed'?'removed':'missing';}
    }
    if(state!==item.state||head!==item.head_sha)return this.store.updateWorktree(taskId,lease,fencingToken,state,head);
    return item;
  }
  async remove({taskId,lease,fencingToken=lease?.fencingToken,force=false,signal}={}) {
    this.store.assertLease(taskId,lease);
    let item=this.store.getWorktree(taskId,lease,fencingToken);
    if(item.state==='removed')return item;
    if(item.state!=='removing')item=this.store.updateWorktree(taskId,lease,fencingToken,'removing');
    try{
      await runGit(item.repository,['worktree','remove',...(force?['--force']:[]),item.path],{timeoutMs:this.timeoutMs,signal});
      return this.store.updateWorktree(taskId,lease,fencingToken,'removed');
    }catch(error){
      try{await this.reconcile({taskId,lease,fencingToken,signal});}catch{/* keep original remove error */}
      throw error;
    }
  }
  async cleanupStale({taskId,lease,signal}={}) {
    this.store.assertLease(taskId,lease);
    const stale=this.store.listWorktrees(taskId,lease).filter(x=>x.fencing_token<lease.fencingToken&&x.state==='ready');
    const results=[];
    for(const item of stale){
      try{results.push(await this.remove({taskId,lease,fencingToken:item.fencing_token,signal}));}
      catch(error){results.push({fencing_token:item.fencing_token,state:'preserved',reason:error.message});}
    }
    return results;
  }
}
