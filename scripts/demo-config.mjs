// Dependency-free startup validation; this module can run before npm ci.
export function portNumber(value, label) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1024 || Number(value) > 65535)
    throw new Error(`${label} must be an integer from 1024 to 65535.`);
  return Number(value);
}

export function demoOptions(args) {
  const options = { port: 3000, dbPort: undefined, ai: false, check: false, help: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error(`Repeated option: ${flag}`);
    seen.add(flag);
    if (flag === '--ai') options.ai = true;
    else if (flag === '--check') options.check = true;
    else if (flag === '--help') options.help = true;
    else if (flag === '--port') options.port = portNumber(args[++i], 'App port');
    else if (flag === '--db-port') options.dbPort = portNumber(args[++i], 'Database port');
    else throw new Error('Unknown option. Use npm run demo -- --help.');
  }
  return options;
}

export function validateDemoConfig(config, requestedDbPort) {
  if (config.DEMO_MODE !== 'true' || config.LIVE_OPERATIONS !== 'false')
    throw new Error('Demo startup requires DEMO_MODE=true and LIVE_OPERATIONS=false. Existing settings were not changed.');
  let url;
  try { url = new URL(config.DATABASE_URL); }
  catch { throw new Error('Invalid DATABASE_URL. See DEMO_START.md; no connection attempted.'); }
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' ||
      url.pathname !== '/liam_nfactorial' || url.username !== 'liam_demo' ||
      !url.password || url.search || url.hash)
    throw new Error('Demo startup only manages liam_demo@127.0.0.1/liam_nfactorial. Refusing other databases; use a clean demo checkout.');
  const dbPort = portNumber(url.port, 'Database port');
  if (requestedDbPort !== undefined && dbPort !== requestedDbPort)
    throw new Error('--db-port differs from the existing .env.local. Use its current port or a separate clean checkout.');
  if (!config.DEMO_PASSWORD || config.DEMO_PASSWORD.length < 16)
    throw new Error('DEMO_PASSWORD must contain at least 16 characters. Existing account passwords are not reset by startup.');
  return dbPort;
}

export function aiEnvironment(config, enabled) {
  const disabled = {
    OPENAI_API_KEY: '', LANGFUSE_PUBLIC_KEY: '', LANGFUSE_SECRET_KEY: '',
    LANGSMITH_API_KEY: '', LANGSMITH_TRACING: 'false', AI_TRACING_PROVIDER: 'off',
  };
  if (!enabled) return disabled;
  if (!config.OPENAI_API_KEY?.trim())
    throw new Error('--ai requires OPENAI_API_KEY in .env.local. See AI_SETUP.md; use npm run demo for guided mode.');
  const provider = config.AI_TRACING_PROVIDER || 'langfuse';
  if (provider === 'langfuse' && (!config.LANGFUSE_PUBLIC_KEY?.trim() || !config.LANGFUSE_SECRET_KEY?.trim()))
    throw new Error('--ai requires both Langfuse keys in .env.local. See AI_SETUP.md.');
  if (provider === 'langsmith' && !config.LANGSMITH_API_KEY?.trim())
    throw new Error('--ai requires LANGSMITH_API_KEY in .env.local. See AI_SETUP.md.');
  if (!['langfuse', 'langsmith'].includes(provider))
    throw new Error('--ai requires AI_TRACING_PROVIDER=langfuse or langsmith.');
  return { ...disabled, OPENAI_API_KEY: config.OPENAI_API_KEY, AI_TRACING_PROVIDER: provider,
    ...(provider === 'langfuse'
      ? { LANGFUSE_PUBLIC_KEY: config.LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY: config.LANGFUSE_SECRET_KEY }
      : { LANGSMITH_API_KEY: config.LANGSMITH_API_KEY }) };
}
