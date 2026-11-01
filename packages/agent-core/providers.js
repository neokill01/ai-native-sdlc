/** Provider credentials stay on the host. No automatic cross-provider fallback. */
export function providerConfig(provider = 'openai', { env = process.env, model } = {}) {
  const definitions = {
    openai: { key: 'OPENAI_API_KEY', model: 'DEVOS_OPENAI_MODEL', endpoint: 'https://api.openai.com/v1/responses' },
    deepseek: { key: 'DEEPSEEK_API_KEY', model: 'DEVOS_DEEPSEEK_MODEL', endpoint: 'https://api.deepseek.com/responses' },
  };
  if (!Object.hasOwn(definitions, provider)) throw new Error('Unsupported model provider');
  const config = definitions[provider];
  const apiKey = env[config.key], selectedModel = model ?? env[config.model];
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error(`${config.key} is required`);
  if (typeof selectedModel !== 'string' || !selectedModel.trim()) throw new Error(`${config.model} or --model is required`);
  return { apiKey, model: selectedModel, baseUrl: config.endpoint };
}
