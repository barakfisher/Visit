import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

// Browser suites run against a dedicated database and Redis logical database, never the development ones.
// Every API setting is assigned here, so the API's own .env loading (which never overrides set keys) contributes nothing.
export const TEST_DATABASE_NAME = 'visit_test';
export const TEST_REDIS_DATABASE = 1;
// Matches the local-only credentials committed in docker-compose.yml; CI supplies its own through VISIT_TEST_* variables.
const LOCAL_DATABASE_URL = `postgresql://visit:visit_local_only@localhost:5432/${TEST_DATABASE_NAME}?schema=public`;
const LOCAL_REDIS_URL = `redis://localhost:6380/${TEST_REDIS_DATABASE}`;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Parses without echoing the URL: a parse error would otherwise print any password it contains.
function parsedLocalUrl(name: string, value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`${name} is not a valid URL.`); }
  // pg also honours host/port query parameters, so they could redirect a loopback-looking URL elsewhere.
  if (!LOOPBACK_HOSTS.has(url.hostname) || url.searchParams.has('host') || url.searchParams.has('port')) throw new Error(`${name} must point at a loopback host.`);
  return url;
}

export function testEnvironment({ apiPort, webUrl }: { apiPort: number; webUrl: string }) {
  const databaseUrl = process.env.VISIT_TEST_DATABASE_URL ?? LOCAL_DATABASE_URL;
  const redisUrl = process.env.VISIT_TEST_REDIS_URL ?? LOCAL_REDIS_URL;
  const database = parsedLocalUrl('VISIT_TEST_DATABASE_URL', databaseUrl).pathname.slice(1);
  if (database !== TEST_DATABASE_NAME) throw new Error(`Browser tests only run against the ${TEST_DATABASE_NAME} database, not "${database}".`);
  if (parsedLocalUrl('VISIT_TEST_REDIS_URL', redisUrl).pathname !== `/${TEST_REDIS_DATABASE}`) throw new Error(`Browser tests only run against Redis logical database ${TEST_REDIS_DATABASE}.`);
  return {
    NODE_ENV: 'development',
    API_HOST: '127.0.0.1',
    API_PORT: String(apiPort),
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    SESSION_SECRET: randomBytes(32).toString('base64url'),
    TRUSTED_PROXY_CIDRS: '',
    EMAIL_DELIVERY_MODE: 'local-inbox',
    EMAIL_API_KEY: '',
    EMAIL_FROM: 'Visit <login@localhost>',
    WEB_APP_URL: webUrl,
    SMS_DELIVERY_MODE: 'local-inbox',
    TWILIO_ACCOUNT_SID: '',
    TWILIO_AUTH_TOKEN: '',
    TWILIO_MESSAGING_SERVICE_SID: '',
    TWILIO_VERIFY_SERVICE_SID: '',
    GOOGLE_CLIENT_IDS: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_CALLBACK_URL: '',
    GOOGLE_NATIVE_RETURN_URL: '',
    PLATFORM_ADMIN_EMAILS: '',
  };
}

// Applies committed migrations to the test database; Prisma creates the database when it does not exist yet.
export function migrateTestDatabase(repoRoot: string, databaseUrl: string) {
  const apiRoot = path.join(repoRoot, 'apps/api');
  execFileSync(path.join(repoRoot, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], { cwd: apiRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'pipe' });
}
