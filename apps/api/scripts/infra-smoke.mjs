import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const temporary = await mkdtemp(resolve(tmpdir(), 'visit-infra-'));
const project = `visit-infra-${process.pid}-${Date.now()}`;
const execute = promisify(execFile);
const checks = [];
const environment = {
  ...process.env,
  SESSION_SECRET: 'isolated-infra-test-only-secret-at-least-32-characters',
  SMS_DELIVERY_MODE: 'disabled', GOOGLE_CLIENT_IDS: '', PLATFORM_ADMIN_EMAILS: '',
  WEB_APP_URL: 'http://localhost:8081',
};
const override = resolve(temporary, 'compose.yml');
const failureOverride = resolve(temporary, 'migration-failure.yml');
const composeArgs = ['compose', '--env-file', resolve(root, '.env.example'), '-p', project, '-f', resolve(root, 'docker-compose.yml'), '-f', override];
async function docker(args, timeout = 120_000) {
  return execute('docker', args, { cwd: root, env: environment, timeout, maxBuffer: 10 * 1024 * 1024 });
}
const compose = (args, timeout) => docker([...composeArgs, ...args], timeout);
function pass(name) { checks.push(name); console.log(`PASS ${name}`); }
async function until(check, label, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out: ${label}`);
}
async function status(base, path) {
  try { return await fetch(new URL(path, base), { signal: AbortSignal.timeout(10_000) }); }
  catch { return null; }
}
let failure;
let failureDiagnostics = '';
try {
  await writeFile(override, `services:
  api:
    ports: !override ["127.0.0.1:0:3000"]
  postgres:
    ports: !reset []
  redis:
    ports: !reset []
`);
  console.log('Building an isolated API image and starting fresh database/Redis volumes…');
  await compose(['build', 'api'], 300_000);
  await compose(['up', '-d', '--wait', '--wait-timeout', '90'], 120_000);
  const { stdout: mapping } = await compose(['port', 'api', '3000']);
  let base = `http://${mapping.trim()}`;
  const live = await status(base, '/health/live');
  assert.equal(live?.status, 200);
  const ready = await status(base, '/health/ready');
  assert.equal(ready?.status, 200);
  assert.deepEqual(await ready.json(), { status: 'ready', database: 'ok', redis: 'ok' });
  pass('fresh Compose startup applies migrations before API readiness');
  if (process.argv.includes('--api-tests')) {
    await compose(['exec', '-T', 'api', 'npm', 'test', '--workspace', '@visit/api'], 120_000);
    pass('API integration suite passes against the fresh isolated PostgreSQL and Redis services');
  }

  // These are this test project's dependencies; the user's development services are untouched.
  await compose(['stop', 'redis']);
  const noRedis = await status(base, '/health/ready');
  assert.equal(noRedis?.status, 503);
  assert.deepEqual(await noRedis.json(), { status: 'not_ready', database: 'ok', redis: 'unavailable' });
  assert.equal((await status(base, '/health/live'))?.status, 200);
  pass('Redis outage makes readiness 503 while process liveness stays 200');
  await compose(['restart', 'api']);
  const { stdout: restartedMapping } = await compose(['port', 'api', '3000']);
  base = `http://${restartedMapping.trim()}`;
  await until(async () => (await status(base, '/health/live'))?.status === 200, 'API restart without Redis');
  const initialRedisFailure = await status(base, '/health/ready');
  assert.equal(initialRedisFailure?.status, 503);
  assert.equal((await initialRedisFailure.json()).redis, 'unavailable');
  pass('initial lazy Redis connection fails within the readiness deadline');
  await compose(['start', 'redis']);
  await until(async () => (await status(base, '/health/ready'))?.status === 200, 'Redis recovery');
  pass('readiness recovers when Redis returns');

  await compose(['stop', 'postgres']);
  const noDatabase = await status(base, '/health/ready');
  assert.equal(noDatabase?.status, 503);
  const databaseFailure = await noDatabase.json();
  assert.equal(databaseFailure.database, 'unavailable');
  assert.equal((await status(base, '/health/live'))?.status, 200);
  pass('database outage has bounded readiness failure without leaking connection details');
  await compose(['start', 'postgres']);
  await until(async () => (await status(base, '/health/ready'))?.status === 200, 'database recovery');

  let invalidOutput = '';
  let invalidExit = 0;
  try {
    await compose(['run', '--rm', '--no-deps', '-e', 'SESSION_SECRET=short', 'api', 'node', 'apps/api/dist/server.js']);
  } catch (error) {
    invalidExit = Number(error.code);
    invalidOutput = `${error.stdout ?? ''}${error.stderr ?? ''}`;
  }
  assert.equal(invalidExit, 1);
  assert.match(invalidOutput, /Invalid environment configuration\. Check: SESSION_SECRET/);
  assert.doesNotMatch(invalidOutput, /isolated-infra-test-only-secret/);
  pass('invalid environment exits before API startup with field-only diagnostics');

  const migrationFolder = resolve(temporary, '20990101000000_failure_probe');
  await mkdir(migrationFolder);
  await writeFile(resolve(migrationFolder, 'migration.sql'), 'SELECT 1 / 0;\n');
  await writeFile(failureOverride, `services:
  api:
    volumes:
      - type: bind
        source: ${JSON.stringify(migrationFolder)}
        target: /workspace/apps/api/prisma/migrations/20990101000000_failure_probe
        read_only: true
`);
  const failedCompose = args => docker([...composeArgs, '-f', failureOverride, ...args]);
  await failedCompose(['up', '-d', '--no-deps', '--force-recreate', 'api']);
  const { stdout: containerId } = await failedCompose(['ps', '-a', '-q', 'api']);
  let containerState;
  await until(async () => {
    const { stdout } = await docker(['inspect', '-f', '{{json .State}}', containerId.trim()]);
    containerState = JSON.parse(stdout);
    return containerState.Status === 'exited';
  }, 'migration failure stops API');
  assert.notEqual(containerState.ExitCode, 0);
  assert.notEqual(containerState.Health?.Status, 'healthy');
  const { stdout: failedMapping } = await failedCompose(['port', 'api', '3000']).catch(() => ({ stdout: '' }));
  if (failedMapping.trim()) assert.notEqual((await status(`http://${failedMapping.trim()}`, '/health/ready'))?.status, 200);
  pass('failed migration stops container entrypoint before a healthy API can start');
} catch (error) {
  failure = error;
  // Avoid printing raw child-process output: it may contain environment or provider values.
  console.error(`FAIL infrastructure smoke: ${error instanceof assert.AssertionError || !error.cmd ? error.message : `Docker command failed (${error.code ?? 'unknown'})`}`);
  const { stdout } = await compose(['logs', '--no-color', '--tail', '80', 'api']).catch(() => ({ stdout: '' }));
  failureDiagnostics = stdout.replaceAll(environment.SESSION_SECRET, '[REDACTED]').replaceAll('visit_local_only', '[REDACTED]').replace(/(?:postgres(?:ql)?|redis):\/\/[^\s"']+/g, '[REDACTED CONNECTION]');
} finally {
  try {
    await compose(['down', '--volumes', '--remove-orphans']);
    pass('isolated containers, networks and test volumes removed');
  } catch { failure ??= new Error('Isolated test cleanup failed'); console.error(`Cleanup failed for test project ${project}`); }
  await rm(temporary, { recursive: true, force: true });
  const resultsDirectory = resolve(root, 'apps/api/test-results');
  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(resolve(resultsDirectory, 'infra-smoke.json'), JSON.stringify({ at: new Date().toISOString(), commit: process.env.VISIT_TEST_COMMIT ?? null, passed: !failure, checks }, null, 2));
  if (failureDiagnostics) await writeFile(resolve(resultsDirectory, 'infra-smoke-failure.log'), failureDiagnostics);
  else await rm(resolve(resultsDirectory, 'infra-smoke-failure.log'), { force: true });
}
if (failure) process.exitCode = 1;
