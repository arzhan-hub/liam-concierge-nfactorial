import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoOptions, validateDemoConfig, aiEnvironment } from '../scripts/demo-config.mjs';

const config = {
  DATABASE_URL: 'postgresql://liam_demo:fictional-test-password@127.0.0.1:55433/liam_nfactorial',
  DEMO_MODE: 'true', LIVE_OPERATIONS: 'false', DEMO_PASSWORD: 'fictional-test-password',
};
test('mentor startup refuses production, remote and ambiguous database settings', () => {
  assert.equal(validateDemoConfig(config, undefined), 55433);
  for (const change of [
    { LIVE_OPERATIONS: 'true' }, { DEMO_MODE: 'false' },
    { DATABASE_URL: config.DATABASE_URL.replace('127.0.0.1', 'example.com') },
    { DATABASE_URL: config.DATABASE_URL.replace('/liam_nfactorial', '/liam') },
    { DATABASE_URL: config.DATABASE_URL.replace('liam_demo:', 'liam:') },
    { DATABASE_URL: config.DATABASE_URL + '?options=-csearch_path=public' },
    { DATABASE_URL: config.DATABASE_URL + '#fragment' },
    { DATABASE_URL: 'not-a-url' }, { DEMO_PASSWORD: 'short' },
  ]) assert.throws(() => validateDemoConfig({ ...config, ...change }, undefined));
  assert.throws(() => validateDemoConfig(config, 55434), /differs/);
});
test('guided startup disables inherited model and tracing credentials', () => {
  const secrets = { OPENAI_API_KEY: 'fake-openai', LANGFUSE_PUBLIC_KEY: 'fake-public',
    LANGFUSE_SECRET_KEY: 'fake-secret', LANGSMITH_API_KEY: 'fake-smith' };
  const env = { ...secrets, ...aiEnvironment(secrets, false) };
  for (const key of Object.keys(secrets)) assert.equal(env[key as keyof typeof env], '');
  assert.equal(env.AI_TRACING_PROVIDER, 'off');
  assert.equal(env.LANGSMITH_TRACING, 'false');
});
test('AI startup requires explicit complete tracing configuration without credential disclosure', () => {
  assert.throws(() => aiEnvironment({}, true), /OPENAI_API_KEY/);
  assert.throws(() => aiEnvironment({ OPENAI_API_KEY: 'fake-openai' }, true), /Langfuse/);
  assert.throws(() => aiEnvironment({ OPENAI_API_KEY: 'fake-openai', AI_TRACING_PROVIDER: 'off' }, true), /requires AI_TRACING/);
  const smith = aiEnvironment({ OPENAI_API_KEY: 'fake-openai', AI_TRACING_PROVIDER: 'langsmith', LANGSMITH_API_KEY: 'fake-smith' }, true);
  assert.equal(smith.AI_TRACING_PROVIDER, 'langsmith');
  assert.equal(smith.LANGFUSE_SECRET_KEY, '');
  const fuse = aiEnvironment({ OPENAI_API_KEY: 'fake-openai', LANGFUSE_PUBLIC_KEY: 'fake-public', LANGFUSE_SECRET_KEY: 'fake-secret' }, true);
  assert.equal(fuse.AI_TRACING_PROVIDER, 'langfuse');
  assert.equal(fuse.LANGSMITH_API_KEY, '');
});
test('launcher rejects unknown, repeated, missing or unsafe port arguments', () => {
  const options = demoOptions(['--port', '3105', '--db-port', '55434', '--ai', '--check']);
  assert.equal(options.port, 3105);
  assert.equal(options.dbPort, 55434);
  assert.equal(options.ai, true);
  for (const args of [['--reset'], ['--port'], ['--port', '0'], ['--port', '1.5'],
    ['--port', '65536'], ['--port', '3000; echo nope'], ['--ai', '--ai']])
    assert.throws(() => demoOptions(args));
});
