import { randomUUID } from 'node:crypto';

export function readUsage(response) {
  const u = response.usage;
  if (!u || !['input_tokens', 'output_tokens', 'total_tokens'].every(k => Number.isSafeInteger(u[k]) && u[k] >= 0) ||
    u.total_tokens !== u.input_tokens + u.output_tokens) throw new Error('Missing or invalid model usage; reconciliation required');
  return { inputTokens: u.input_tokens, outputTokens: u.output_tokens, totalTokens: u.total_tokens };
}

/** Task-wide ledger. A request without known usage blocks automatic retries. */
export function taskBudget(store, taskId, lease, policy) {
  store.assertLease(taskId, lease);
  const events = store.events(taskId);
  const previous = events.find(e => e.type === 'model.budget_configured');
  if (previous && JSON.stringify(previous.payload.policy) !== JSON.stringify(policy)) throw new Error('Task model budget policy cannot change on retry');
  const history = events.filter(e => e.type === 'model.usage');
  if (history.some(e => e.payload.model !== policy.model)) throw new Error('Historical model pricing requires reconciliation');
  const completed = new Set(history.map(e => e.payload.requestId));
  if (events.some(e => e.type === 'model.request_started' && !completed.has(e.payload.requestId))) {
    throw new Error('Uncertain model request usage requires reconciliation');
  }
  if (!previous) store.event(taskId, 'model.budget_configured', { policy });
  const usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: policy.pricing ? 0 : null };
  for (const event of history) {
    const u = event.payload;
    if (![u.inputTokens, u.outputTokens, u.totalTokens].every(n => Number.isSafeInteger(n) && n >= 0) ||
      u.totalTokens !== u.inputTokens + u.outputTokens) throw new Error('Invalid historical model usage');
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
    usage.totalTokens += u.totalTokens;
    if (policy.pricing) usage.estimatedCostUsd += (u.inputTokens * policy.pricing.inputUsdPerMillion + u.outputTokens * policy.pricing.outputUsdPerMillion) / 1_000_000;
    if (![usage.inputTokens, usage.outputTokens, usage.totalTokens].every(Number.isSafeInteger) ||
      (usage.estimatedCostUsd !== null && !Number.isFinite(usage.estimatedCostUsd))) throw new Error('Historical model usage exceeds accounting range');
  }
  let turns = history.length;
  let toolCalls = events.filter(e => e.type === 'model.tool_call').length;
  const exhausted = () => {
    if (usage.totalTokens >= policy.maxTotalTokens || (policy.maxCostUsd !== null && usage.estimatedCostUsd >= policy.maxCostUsd)) throw new Error('Model budget exceeded');
  };
  return {
    usage,
    get toolCalls() { return toolCalls; },
    beforeRequest() {
      store.assertLease(taskId, lease);
      exhausted();
      if (turns >= policy.maxTurns) throw new Error('Model turn budget exhausted');
      if (policy.maxTotalTokens - usage.totalTokens < 16) throw new Error('Model token budget exhausted');
      const requestId = randomUUID();
      store.event(taskId, 'model.request_started', { requestId, model: policy.model, turn: turns + 1 });
      return requestId;
    },
    charge(requestId, turnUsage) {
      store.assertLease(taskId, lease);
      turns++;
      const estimatedCostUsd = policy.pricing ? (turnUsage.inputTokens * policy.pricing.inputUsdPerMillion + turnUsage.outputTokens * policy.pricing.outputUsdPerMillion) / 1_000_000 : null;
      store.event(taskId, 'model.usage', { requestId, model: policy.model, turn: turns, ...turnUsage, estimatedCostUsd });
      for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) usage[key] += turnUsage[key];
      if (estimatedCostUsd !== null) usage.estimatedCostUsd += estimatedCostUsd;
      // An exactly consumed allowance can finish, but cannot start another request.
      if (usage.totalTokens > policy.maxTotalTokens || (policy.maxCostUsd !== null && usage.estimatedCostUsd > policy.maxCostUsd)) throw new Error('Model budget exceeded');
    },
    allowTools(count) {
      if (toolCalls + count > policy.maxToolCalls) throw new Error('Model tool-call budget exceeded');
    },
    toolRecorded() { toolCalls++; },
  };
}
