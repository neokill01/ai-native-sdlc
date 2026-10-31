/** Trusted adapters only. No tool execution or sandbox is provided here. */
export async function runTask(store, id, { runtime, evaluator, timeoutMs = 60_000, signal } = {}) {
  if (!runtime?.execute || !evaluator?.verify || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid adapters or timeout');
  let task = store.get(id);
  if (!['queued', 'running', 'verifying', 'repairing'].includes(task.status)) throw new Error('Task is not runnable');
  // A pending side effect after a crash is uncertain. Never replay it automatically.
  if (task.checkpoint?.operation === 'pending') {
    if (task.status !== 'running') throw new Error('Invalid pending checkpoint');
    const paused = store.transition(id, task.version, 'paused', 'uncertain_operation');
    store.report(id);
    return paused;
  }
  const controller = new AbortController();
  const deadline = task.checkpoint?.deadline ?? Date.now() + timeoutMs;
  let timer;
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
        task = store.transition(id, task.version, 'running');
      }
      if (task.status === 'running' && task.checkpoint?.operation === 'finished') {
        task = store.transition(id, task.version, 'verifying');
      }
      if (task.status === 'running') {
        // Persist intent before handing control to an adapter; key is stable for reconciliation.
        const operationKey = `${id}:${task.repairs}`;
        task = store.checkpoint(id, task.version, { deadline, operation: 'pending', operationKey });
        await invoke(abortSignal => runtime.execute({ task: structuredClone(task), operationKey, signal: abortSignal }));
        task = store.checkpoint(id, task.version, { operation: 'finished' });
        task = store.transition(id, task.version, 'verifying');
      }
      if (task.status === 'verifying') {
        // Verification adapters must be read-only/repeatable. Persist deadline on recovery too.
        task = store.checkpoint(id, task.version, { deadline });
        const result = await invoke(abortSignal => evaluator.verify({ task: structuredClone(task), signal: abortSignal }));
        task = store.verification(id, task.version, result?.verdict, result?.evidence);
        if (task.verification === 'passed') return store.transition(id, task.version, 'completed');
        if (task.repairs >= task.maxRepairs) return store.transition(id, task.version, 'failed', 'repair_budget_exceeded');
        task = store.transition(id, task.version, 'repairing');
      }
    }
  } catch (error) {
    // A concurrent state/version update is never overwritten with a stale snapshot.
    const current = store.get(id);
    if (current.version !== task.version) throw error;
    if (!['queued', 'running', 'verifying', 'repairing'].includes(current.status)) throw error;
    const status = signal?.aborted ? 'cancelled' : 'failed';
    const reason = signal?.aborted ? 'cancelled' : controller.signal.aborted || Date.now() >= deadline ? 'timeout' : 'adapter_failed';
    return store.transition(id, current.version, status, reason);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    store.report(id);
  }
}
