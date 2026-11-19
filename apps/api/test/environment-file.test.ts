import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// env.ts reads ../../.env relative to the working directory, so each child runs two levels below a
// temporary directory holding a synthetic .env. Nothing here reads the developer's own .env.
const ENV_MODULE = fileURLToPath(new URL('../src/env.ts', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');
const FILE_EMAIL_KEY = 'file-email-key-must-not-load';
const FILE_SMS_TOKEN = 'file-sms-token-must-not-load-0000000';
const EXPLICIT_EMAIL_KEY = 'explicit-email-key';
const FILE_FROM = 'Visit <login@file.example>';

function loadEnvironment(fileLines: string[], explicit: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'visit-env-'));
  try {
    const cwd = join(root, 'apps', 'api');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(root, '.env'), [
      'DATABASE_URL=postgresql://file:file@localhost:5432/file',
      'SESSION_SECRET=file-session-secret-at-least-thirty-two-chars',
      ...fileLines,
    ].join('\n'));
    const script = `import(${JSON.stringify(ENV_MODULE)}).then(({ env }) => console.log(JSON.stringify({ email: env.EMAIL_DELIVERY_MODE, key: env.EMAIL_API_KEY ?? null, from: env.EMAIL_FROM, sms: env.SMS_DELIVERY_MODE, token: env.TWILIO_AUTH_TOKEN ?? null, database: env.DATABASE_URL })))`;
    // Only what the child needs to start: no inherited configuration can fill a gap.
    const result = spawnSync(process.execPath, ['--import', TSX_LOADER, '-e', script], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...explicit } });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim().split('\n').at(-1)!) as { email: string; key: string | null; from: string; sms: string; token: string | null; database: string };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

const FILE_PROVIDERS = [
  'EMAIL_DELIVERY_MODE=resend', `EMAIL_API_KEY=${FILE_EMAIL_KEY}`, `EMAIL_FROM=${FILE_FROM}`,
  'SMS_DELIVERY_MODE=local-inbox', `TWILIO_AUTH_TOKEN=${FILE_SMS_TOKEN}`,
];

test('under the test runner, outbound message settings in .env are ignored and the local inbox is used', () => {
  const loaded = loadEnvironment(FILE_PROVIDERS, { NODE_TEST_CONTEXT: 'child-v8' });
  assert.equal(loaded.email, 'local-inbox');
  assert.equal(loaded.key, null);
  assert.equal(loaded.sms, 'disabled');
  assert.equal(loaded.token, null);
  // Everything else still comes from the file, so a local test run keeps its database.
  assert.equal(loaded.database, 'postgresql://file:file@localhost:5432/file');
  assert.equal(loaded.from, FILE_FROM);
});

test('under the test runner, a provider a test sets explicitly is kept', () => {
  const loaded = loadEnvironment(FILE_PROVIDERS, { NODE_TEST_CONTEXT: 'child-v8', EMAIL_DELIVERY_MODE: 'resend', EMAIL_API_KEY: EXPLICIT_EMAIL_KEY });
  assert.equal(loaded.email, 'resend');
  assert.equal(loaded.key, EXPLICIT_EMAIL_KEY);
});

test('a value already in the environment, even empty, wins over the file', () => {
  const loaded = loadEnvironment(FILE_PROVIDERS, { DATABASE_URL: 'postgresql://explicit:explicit@localhost:5432/explicit', EMAIL_FROM: '' });
  assert.equal(loaded.database, 'postgresql://explicit:explicit@localhost:5432/explicit');
  assert.equal(loaded.from, '');
});

test('outside the test runner, .env configures the providers as before', () => {
  const loaded = loadEnvironment(FILE_PROVIDERS, {});
  assert.equal(loaded.email, 'resend');
  assert.equal(loaded.key, FILE_EMAIL_KEY);
  assert.equal(loaded.sms, 'local-inbox');
  assert.equal(loaded.token, FILE_SMS_TOKEN);
});
