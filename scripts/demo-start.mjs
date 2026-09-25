#!/usr/bin/env node
// One entry point for a clean mentor checkout. Uses only Node built-ins until installation.
import { readFile, writeFile, mkdir, access, lstat, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { demoOptions, validateDemoConfig, aiEnvironment } from './demo-config.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const local = path.join(root, '.local');
const data = path.join(local, 'postgres');
const lock = path.join(local, 'demo-launcher.lock');
const exists = async file => access(file).then(() => true, () => false);
let child, stopping = false, locked = false, manageDatabase = false, wasRunning = false;
let runtime = { ...process.env };
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  stopping = true;
  // Include npm's descendants and MCP subprocesses in graceful shutdown.
  if (child?.pid) {
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') child.kill(signal); }
  }
});

function run(command, args, env = runtime) {
  if (stopping) throw new Error('Startup interrupted.');
  return new Promise((resolve, reject) => {
    const current = child = spawn(command, args, { cwd: root, env, stdio: 'inherit', detached: true });
    current.once('error', () => { child = undefined; reject(new Error(`Could not start ${command}. See DEMO_START.md.`)); });
    current.once('exit', (code, signal) => {
      child = undefined;
      if (stopping) reject(new Error('Startup interrupted.'));
      else if (code === 0) resolve();
      else reject(new Error(`${command} ${args[0] || ''} failed${signal ? ` (${signal})` : ` (exit ${code})`}. See the output above.`));
    });
  });
}
function checkedOutput(command, args) {
  const r = spawnSync(command, args, { encoding: 'utf8', env: runtime });
  if (r.status !== 0) throw new Error(`Missing or unusable dependency: ${command}. See DEMO_START.md.`);
  return r.stdout.trim();
}
function freePort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is unavailable. Existing processes were not stopped. See --port / --db-port in DEMO_START.md.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
function databaseRunning() {
  return spawnSync('pg_ctl', ['-D', data, 'status'], { stdio: 'ignore' }).status === 0;
}

try {
  const options = demoOptions(process.argv.slice(2));
  if (options.help) {
    console.log('Liam Concierge — mentor demonstration\n\nnpm run demo [-- --port 3000 --db-port 55433 --ai --check]\n\nDefault: guided mode, no paid AI calls. --ai explicitly enables paid AI and PDF indexing.\n--check validates prerequisites/settings/ports without installing, seeding or starting.\n--db-port is for a NEW checkout; it never rewrites an existing database URL.\nRequires Node 26+, PostgreSQL 16 tools + pgvector, and Poppler. See DEMO_START.md.');
  } else {
    if (Number(process.versions.node.split('.')[0]) < 26) throw new Error('Install Node.js 26 or later.');
    if (process.platform === 'win32') throw new Error('Use WSL2 on Windows. Native Windows startup is not supported.');
    checkedOutput('npm', ['--version']);
    for (const command of ['initdb', 'pg_ctl', 'pg_config']) {
      if (!/\b16\./.test(checkedOutput(command, ['--version'])))
        throw new Error(`${command} must come from PostgreSQL 16. Check PATH; see DEMO_START.md.`);
    }
    checkedOutput('pdftotext', ['-v']);
    if (!(await exists(path.join(checkedOutput('pg_config', ['--sharedir']), 'extension', 'vector.control'))))
      throw new Error('pgvector is missing for the selected PostgreSQL 16. See DEMO_START.md.');
    if (typeof process.getuid === 'function' && process.getuid() === 0)
      throw new Error('Run as a regular user. PostgreSQL initdb cannot run as root.');

    const envExists = await exists('.env.local');
    let config;
    if (envExists) config = parseEnv(await readFile('.env.local', 'utf8'));
    else config = {
      DATABASE_URL: `postgresql://liam_demo:${randomBytes(24).toString('hex')}@127.0.0.1:${options.dbPort || 55433}/liam_nfactorial`,
      APP_URL: `http://localhost:${options.port}`, SETUP_TOKEN: randomBytes(32).toString('hex'),
      LIVE_OPERATIONS: 'false', DEMO_MODE: 'true', DEMO_PASSWORD: randomBytes(18).toString('base64url'),
      FIREBASE_AUTH_ENABLED: 'false', AI_MODEL: 'gpt-4.1-mini-2025-04-14',
      AI_TRACING_PROVIDER: 'langfuse', LANGFUSE_BASE_URL: 'https://cloud.langfuse.com',
      OPENAI_API_KEY: '', LANGFUSE_PUBLIC_KEY: '', LANGFUSE_SECRET_KEY: '', LANGSMITH_API_KEY: '',
    };
    const dbPort = validateDemoConfig(config, options.dbPort);
    if (dbPort === options.port) throw new Error('App and database ports must differ.');
    // Explicit empty environment values prevent Next.js from re-enabling private keys from .env.local.
    runtime = { ...process.env, ...config, ...aiEnvironment(config, options.ai),
      APP_URL: `http://localhost:${options.port}`, DEMO_DB_PORT: String(dbPort),
      LIVE_OPERATIONS: 'false', FIREBASE_AUTH_ENABLED: 'false', FIREBASE_GOOGLE_ENABLED: 'false',
      FIREBASE_APPLE_ENABLED: 'false', GMAIL_CLIENT_ID: '', GMAIL_CLIENT_SECRET: '', MAIL_TOKEN_KEY: '',
      NEXT_TELEMETRY_DISABLED: '1' };
    await freePort(options.port);
    wasRunning = databaseRunning();
    if (!wasRunning) await freePort(dbPort);
    if (await exists(path.join(data, 'PG_VERSION'))) {
      if ((await readFile(path.join(data, 'PG_VERSION'), 'utf8')).trim() !== '16')
        throw new Error('The existing demo cluster is not PostgreSQL 16. No upgrade or data removal attempted.');
    }
    console.log(`Prerequisites and settings OK. Mode: ${options.ai ? 'AI (paid API usage)' : 'guided (no AI API calls)'}.`);
    if (!options.check) {
      await mkdir(local, { recursive: true, mode: 0o700 });
      try { await mkdir(lock); locked = true; }
      catch { throw new Error('A demo launcher lock already exists. Stop that launcher first; see DEMO_START.md for crash recovery.'); }
      await writeFile(path.join(lock, 'pid'), String(process.pid), { mode: 0o600 });
      if (!envExists) {
        const text = '# Private mentor demo configuration. Never commit this file.\n# Optional AI: fill keys, then run npm run demo -- --ai. See AI_SETUP.md.\n' +
          Object.entries(config).map(([key, value]) => `${key}=${value}`).join('\n') + '\n';
        await writeFile('.env.local', text, { mode: 0o600, flag: 'wx' });
      }
      const hash = createHash('sha256').update(await readFile('package-lock.json')).digest('hex');
      const stamp = path.join(local, 'demo-dependencies.sha256');
      const installed = await exists('node_modules/next/package.json') &&
        await readFile(stamp, 'utf8').then(v => v === hash, () => false);
      if (!installed) {
        if (await lstat('node_modules').then(s => s.isSymbolicLink(), () => false))
          throw new Error('node_modules is a shared symlink. Use a clean checkout for mentor startup; shared dependencies were not changed.');
        console.log('Installing locked application dependencies…');
        await run('npm', ['ci'], { ...runtime, NODE_ENV: 'development' });
        await writeFile(stamp, hash, { mode: 0o600 });
      }
      manageDatabase = true;
      console.log('Preparing fictional demo accounts and records…');
      await run(process.execPath, ['scripts/demo-setup.mjs']);
      if (options.ai) {
        console.log('Indexing the included fictional PDF policy. First indexing uses paid embeddings; unchanged indexes are reused.');
        await run(process.execPath, ['--experimental-strip-types', 'scripts/index-policies.ts']);
      }
      console.log('Building the application…');
      await run('npm', ['run', 'build'], { ...runtime, NODE_ENV: 'production' });
      console.log(`\nLiam Concierge\nOpen ${runtime.APP_URL} after the server reports Ready.\nSign-in details: ${path.join(local, 'demo-access.txt')}\nCtrl+C stops the app and a database started by this launcher. Demo records are preserved.\n`);
      await run(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(options.port)],
        { ...runtime, NODE_ENV: 'production' });
    }
  }
} catch (error) {
  if (!stopping) { console.error(`Demo startup: ${error.message}`); process.exitCode = 1; }
} finally {
  if (manageDatabase && !wasRunning && databaseRunning()) {
    const stopped = spawnSync('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'], { encoding: 'utf8' });
    console.log(stopped.status === 0 ? 'Demo database stopped; records preserved.' : 'Database stop failed. Run npm run demo:stop from this checkout.');
    if (stopped.status !== 0) process.exitCode = 1;
  }
  if (locked) await rm(lock, { recursive: true, force: true });
}
