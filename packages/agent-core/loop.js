/** Trusted adapters only. No tool execution or sandbox is provided here. */
export async function runTask(store, id, { runtime, evaluator, timeoutMs = 60_000, signal, workerId = `worker-${process.pid}`, leaseTtlMs = Math.min(3_600_000, Math.max(timeoutMs + 30_000, 60_000)), worktreeManager, repository, baseRef = 'HEAD' } = {}) {
  if (!runtime?.execute || !evaluator?.verify || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid adapters or timeout');
  if (!store.acquireLease || !store.renewLease || !store.releaseLease) throw new Error('Fenced task lease support required');
  if (timeoutMs > 3_570_000 || !Number.isSafeInteger(leaseTtlMs) || leaseTtlMs < timeoutMs || leaseTtlMs > 3_600_000) throw new Error('Invalid execution or lease budget');
  const lease = store.acquireLease(id, workerId, leaseTtlMs);
  let task = store.get(id);
  if (!['queued', 'running', 'verifying', 'repairing'].includes(task.status)) { store.releaseLease(id, lease); throw new Error('Task is not runnable'); }
  let worktree = null;
  if (worktreeManager) {
    if (!repository) { store.releaseLease(id, lease); throw new Error('Repository is required when using Git Worktrees'); }
    try { worktree = await worktreeManager.acquire({ taskId: id, lease, repository, baseRef, signal }); }
    catch (error) { try { store.releaseLease(id, lease); } catch {} throw error; }
  }
  // A pending side effect after a crash is uncertain. Never replay it automatically.
  if (task.checkpoint?.operation === 'pending') {
    try {
      if (task.status !== 'running') throw new Error('Invalid pending checkpoint');
      const paused = store.transition(id, task.version, 'paused', 'uncertain_operation', lease);
      store.report(id);
      return paused;
    } finally { try { store.releaseLease(id, lease); } catch { /* lease may have expired */ } }
  }
  const controller = new AbortController();
  const deadline = task.checkpoint?.deadline ?? Date.now() + timeoutMs;
  let timer;
  let activeLease = lease;
  const heartbeat = setInterval(() => { try { activeLease = store.renewLease(id, activeLease, leaseTtlMs); } catch { controller.abort(new Error('lease_lost')); } }, Math.max(1_000, Math.floor(leaseTtlMs / 3)));
  const cancel = () => controller.abort(new Error('cancelled'));
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const remaining = Math.max(0, deadline - Date.now());
  timer = setTimeout(() => controller.abort(new Error('timeout')), remaining);
  if (remaining === 0) controller.abort(new Error('timeout'));
  async function invoke(fn) {
    controller.signal.throwIfAborted();
    let rejectAbort;
    const aborted = new Promise((_, reject) => {
      rejectAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
    });
    try {
      return await Promise.race([Promise.resolve().then(() => fn(controller.signal)), aborted]);
    } finally { controller.signal.removeEventListener('abort', rejectAbort); }
  }
  try {
    while (true) {
      controller.signal.throwIfAborted();
      if (Date.now() >= deadline) throw new Error('timeout');
      if (task.status === 'queued' || task.status === 'repairing') {
        task = store.transition(id, task.version, 'running', null, activeLease);
      }
      if (task.status === 'running' && task.checkpoint?.operation === 'finished') {
        task = store.transition(id, task.version, 'verifying', null, activeLease);
      }
      if (task.status === 'running') {
        // Persist intent before handing control to an adapter; key is stable for reconciliation.
        const operationKey = `${id}:${task.repairs}`;
        task = store.checkpoint(id, task.version, { deadline, operation: 'pending', operationKey }, activeLease);
        await invoke(abortSignal => runtime.execute({ task: structuredClone(task), operationKey, signal: abortSignal, lease: activeLease, workspace: worktree?.path ?? null, worktree }));
        task = store.checkpoint(id, task.version, { operation: 'finished' }, activeLease);
        task = store.transition(id, task.version, 'verifying', null, activeLease);
      }
      if (task.status === 'verifying') {
        // Verification adapters must be read-only/repeatable. Persist deadline on recovery too.
        task = store.checkpoint(id, task.version, { deadline }, activeLease);
        const result = await invoke(abortSignal => evaluator.verify({ task: structuredClone(task), signal: abortSignal, lease: activeLease, workspace: worktree?.path ?? null, worktree }));
        task = store.verification(id, task.version, result?.verdict, result?.evidence, activeLease);
        if (task.verification === 'passed') return store.transition(id, task.version, 'completed', null, activeLease);
        if (task.repairs >= task.maxRepairs) return store.transition(id, task.version, 'failed', 'repair_budget_exceeded', activeLease);
        task = store.transition(id, task.version, 'repairing', null, activeLease);
      }
    }
  } catch (error) {
    // A concurrent state/version update is never overwritten with a stale snapshot.
    const current = store.get(id);
    if (current.version !== task.version) throw error;
    if (!['queued', 'running', 'verifying', 'repairing'].includes(current.status)) throw error;
    const status = signal?.aborted ? 'cancelled' : 'failed';
    const reason = signal?.aborted ? 'cancelled' : controller.signal.aborted || Date.now() >= deadline ? 'timeout' : 'adapter_failed';
    return store.transition(id, current.version, status, reason, activeLease);
  } finally {
    clearTimeout(timer);
    clearInterval(heartbeat);
    signal?.removeEventListener('abort', cancel);
    try { store.releaseLease(id, activeLease); } catch { /* expired or fenced leases are not released by stale workers */ }
    store.report(id);
  }
}
