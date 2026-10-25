import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../http/errors.js';
import { redis, ensureRedisReady } from '../infra/redis.js';
import { env } from '../env.js';

export const phoneSchema = z.string().max(50).transform(value => value.trim().replace(/[\s()-]/g, '')).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use an international phone number with its country code.'));
export type VerifyProvider = { send: (phone: string) => Promise<{ sid: string; createdAt: number }>; check: (sid: string, code: string) => Promise<boolean> };
const invalid = () => new AppError(401, 'INVALID_OTP', 'This code is invalid or expired. Request a new code.');
const unavailable = () => new AppError(503, 'SMS_UNAVAILABLE', 'SMS verification is temporarily unavailable. Please retry shortly.');
const limited = () => new AppError(429, 'RATE_LIMITED', 'Please wait before trying again.');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

type Challenge = { id: string; sid: string; mode: string; expiresAt: number; attempts: number; digest?: string };
const acquire = `if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end if ARGV[2] == 'send' and redis.call('EXISTS', KEYS[2]) == 1 then return 0 end redis.call('SET', KEYS[1], ARGV[1], 'PX', 30000) if ARGV[2] == 'send' then redis.call('SET', KEYS[2], '1', 'EX', 30) end return 1`;
const release = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`;
const save = `if redis.call('GET', KEYS[1]) ~= ARGV[1] or (redis.call('GET', KEYS[4]) or '0') ~= ARGV[5] then return 0 end redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3]) if ARGV[4] ~= '' then redis.call('SET', KEYS[3], ARGV[4], 'PX', ARGV[3]) else redis.call('DEL', KEYS[3]) end return 1`;
const attempt = `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return '' end local raw = redis.call('GET', KEYS[2]) if not raw then return '' end local item = cjson.decode(raw) if item.expiresAt <= tonumber(ARGV[2]) or item.attempts >= 5 then return '' end item.attempts = item.attempts + 1 redis.call('SET', KEYS[2], cjson.encode(item), 'KEEPTTL') return cjson.encode(item)`;
const consume = `if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end local raw = redis.call('GET', KEYS[2]) if not raw then return 0 end local item = cjson.decode(raw) if item.id ~= ARGV[2] or item.expiresAt <= tonumber(ARGV[3]) then return 0 end if redis.call('SET', KEYS[4], '1', 'NX', 'EX', 1200) == false then return 0 end redis.call('DEL', KEYS[2], KEYS[3]) return 1`;

export function createOtpService({ mode, secret, provider, namespace = 'visit:otp', providerScope = env.TWILIO_VERIFY_SERVICE_SID ?? '', now = Date.now, ready = ensureRedisReady }: {
  mode: 'disabled' | 'local-inbox' | 'twilio'; secret: string; provider?: VerifyProvider; namespace?: string; providerScope?: string; now?: () => number; ready?: () => Promise<void>;
}) {
  const ttlMs = mode === 'twilio' ? 600000 : 300000;
  const digest = (phone: string, id: string, code: string) => createHmac('sha256', secret).update(`${phone}:${id}:${code}`).digest('hex');
  const keys = (phone: string) => {
    const id = hash(phone);
    return { operation: `${namespace}:operation:${id}`, cooldown: `${namespace}:cooldown:${id}`, challenge: `${namespace}:challenge:${id}`, inbox: `${namespace}:inbox:${id}`, generation: `${namespace}:generation:${id}` };
  };
  async function rate(key: string, maximum: number, seconds: number) {
    const count = await redis.eval("local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end return n", 1, `${namespace}:limit:${key}`, seconds);
    if (Number(count) > maximum) throw limited();
  }
  async function operation<T>(phone: string, ip: string, action: 'send' | 'verify', work: (owner: string, key: ReturnType<typeof keys>) => Promise<T>): Promise<T> {
    if (mode === 'disabled') throw new AppError(503, 'SMS_NOT_CONFIGURED', 'Phone sign-in is not available yet.');
    const key = keys(phone), owner = randomUUID();
    try {
      await ready();
      await Promise.all(action === 'send' ? [rate(`ip:${hash(ip)}`, 10, 3600), rate(`phone:${hash(phone)}`, 5, 600)] : [rate(`verify:${hash(phone)}`, 8, 300), rate(`verify-ip:${hash(ip)}`, 30, 900)]);
      if (await redis.eval(acquire, 2, key.operation, key.cooldown, owner, action) !== 1) throw limited();
      try { return await work(owner, key); }
      finally { await redis.eval(release, 1, key.operation, owner).catch(() => {}); }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw unavailable();
    }
  }
  return {
    mode,
    async invalidate(phoneInput: string) {
      const key = keys(phoneSchema.parse(phoneInput));
      try { await ready(); await redis.eval("redis.call('INCR', KEYS[1]); redis.call('EXPIRE', KEYS[1], 1200); return redis.call('DEL', KEYS[2], KEYS[3])", 3, key.generation, key.challenge, key.inbox); }
      catch { throw unavailable(); }
    },
    async localCode(phoneInput: string) {
      if (mode !== 'local-inbox') throw invalid();
      const key = keys(phoneSchema.parse(phoneInput)); await ready();
      const raw = await redis.get(key.challenge);
      if (!raw || JSON.parse(raw).expiresAt <= now() || JSON.parse(raw).attempts >= 5) throw invalid();
      const code = await redis.get(key.inbox); if (!code) throw invalid(); return code;
    },
    async send(phoneInput: string, ip: string) {
      const phone = phoneSchema.parse(phoneInput);
      return operation(phone, ip, 'send', async (owner, key) => {
        const generation = await redis.get(key.generation) ?? '0';
        const id = randomUUID();
        const code = mode === 'local-inbox' ? String(randomInt(0, 1000000)).padStart(6, '0') : '';
        let sid: string = id;
        let expiresAt = now() + ttlMs, attempts = 0;
        if (mode === 'twilio') {
          if (!provider) throw unavailable();
          const verification = await provider.send(phone);
          if (!/^VE[\da-fA-F]{32}$/.test(verification.sid) || !Number.isFinite(verification.createdAt)) throw unavailable();
          sid = verification.sid; expiresAt = Math.min(expiresAt, verification.createdAt + ttlMs);
          const previous = await redis.get(key.challenge);
          if (previous) {
            const old = JSON.parse(previous) as Challenge;
            if (old.sid === sid) { expiresAt = Math.min(expiresAt, old.expiresAt); attempts = old.attempts; }
          }
        }
        const remaining = expiresAt - now();
        if (remaining <= 0) throw invalid();
        const challenge: Challenge = { id, sid, mode, expiresAt, attempts, ...(code ? { digest: digest(phone, id, code) } : {}) };
        if (await redis.eval(save, 4, key.operation, key.challenge, key.inbox, key.generation, owner, JSON.stringify(challenge), remaining, code, generation) !== 1) throw unavailable();
        return { accepted: true, expiresInSeconds: Math.floor(remaining / 1000), resendAfterSeconds: 30 };
      });
    },
    async verify(phoneInput: string, code: string, ip: string) {
      const phone = phoneSchema.parse(phoneInput);
      if (!/^\d{6}$/.test(code)) throw invalid();
      return operation(phone, ip, 'verify', async (owner, key) => {
        const raw = await redis.eval(attempt, 2, key.operation, key.challenge, owner, now());
        if (!raw) throw invalid();
        const challenge = JSON.parse(String(raw)) as Challenge;
        if (challenge.mode !== mode) throw invalid();
        const valid = mode === 'twilio' ? await provider?.check(challenge.sid, code) : Boolean(challenge.digest && challenge.digest.length === 64 && timingSafeEqual(Buffer.from(challenge.digest), Buffer.from(digest(phone, challenge.id, code))));
        if (!valid) throw invalid();
        const proofHash = hash(`${mode}:${mode === 'twilio' ? providerScope : namespace}:${challenge.sid}`);
        if (await redis.eval(consume, 4, key.operation, key.challenge, key.inbox, `${namespace}:used:${proofHash}`, owner, challenge.id, now()) !== 1) throw invalid();
        return { phone, proofHash };
      });
    },
  };
}

export function createTwilioProvider({ accountSid, authToken, serviceSid, transport = fetch }: { accountSid: string; authToken: string; serviceSid: string; transport?: typeof fetch }): VerifyProvider {
  async function request(path: string, values: Record<string, string>) {
    try {
      const response = await transport(`https://verify.twilio.com/v2/Services/${serviceSid}/${path}`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values), signal: AbortSignal.timeout(10000) });
      if (response.status === 404 || response.status === 400 && path === 'VerificationCheck') return null;
      if (response.status === 429) throw limited();
      if (!response.ok) throw unavailable();
      return await response.json() as { sid?: string; status?: string; date_created?: string };
    } catch (error) { if (error instanceof AppError) throw error; throw unavailable(); }
  }
  return {
    async send(phone) { const result = await request('Verifications', { To: phone, Channel: 'sms' }); if (!result?.sid || result.status !== 'pending' || !result.date_created) throw unavailable(); return { sid: result.sid, createdAt: Date.parse(result.date_created) }; },
    async check(sid, code) { const result = await request('VerificationCheck', { VerificationSid: sid, Code: code }); return result?.sid === sid && result.status === 'approved'; },
  };
}

export const otpService = createOtpService({ mode: env.SMS_DELIVERY_MODE, secret: env.SESSION_SECRET, ...(env.SMS_DELIVERY_MODE === 'twilio' ? { provider: createTwilioProvider({ accountSid: env.TWILIO_ACCOUNT_SID!, authToken: env.TWILIO_AUTH_TOKEN!, serviceSid: env.TWILIO_VERIFY_SERVICE_SID! }) } : {}) });
