import { createHash, timingSafeEqual } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import { redis, ensureRedisReady } from '../infra/redis.js';
import { AppError, conflict } from '../http/errors.js';
import { newOpaqueToken, sessionExpiry, tokenDigest, validateAuthenticatedSession, type AuthenticatedSession } from './sessions.js';

const invalid = () => new AppError(401, 'INVALID_GOOGLE_PROOF', 'Google sign-in is invalid or expired. Start again.');
const unavailable = () => new AppError(503, 'GOOGLE_UNAVAILABLE', 'Google sign-in is temporarily unavailable.');
export const s256 = (value: string) => createHash('sha256').update(value, 'ascii').digest('base64url');
const opaque = /^[A-Za-z0-9_-]{43}$/;
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export type GoogleConfig = { clientId: string; clientSecret: string; callbackUrl: string; webOrigin: string; nativeReturnUrl?: string };
export type GoogleProvider = { exchange: (input: { code: string; verifier: string; redirectUri: string }) => Promise<Record<string, unknown>> };
type Proof = { platform: 'web' | 'native'; intent: 'login' | 'link'; bindingHash: string; expiresAt: number; identityId?: string; sessionId?: string; appChallenge?: string; clientState?: string };
type Challenge = Proof & { verifier: string; nonce: string };
type Grant = Proof & { subject: string; email: string };

export function validateGoogleClaims(claim: Record<string, unknown>, clientId: string, nonce: string, now = Date.now()) {
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(String(claim.iss)) || claim.aud !== clientId || (claim.azp !== undefined && claim.azp !== clientId) || claim.nonce !== nonce || claim.email_verified !== true || typeof claim.exp !== 'number' || !Number.isInteger(claim.exp) || claim.exp * 1000 <= now || claim.exp * 1000 > now + 7200000 || typeof claim.iat !== 'number' || !Number.isInteger(claim.iat) || claim.iat * 1000 > now + 60000 || claim.iat >= claim.exp || typeof claim.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(claim.sub)) throw invalid();
  const email = z.string().trim().toLowerCase().email().max(254).safeParse(claim.email);
  if (!email.success) throw invalid();
  return { subject: claim.sub, email: email.data };
}

// Fixed HTTPS endpoints and explicit deadlines; no token/code retry. Google access
// and refresh tokens are discarded. The library handles signature/issuer checking.
export function createGoogleProvider(config: GoogleConfig, request: typeof fetch = fetch): GoogleProvider {
  const client = new OAuth2Client();
  let cached: { expiresAt: number; certs: Record<string, string> } | undefined;
  return { async exchange({ code, verifier, redirectUri }) {
    try {
      const response = await request('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, code_verifier: verifier, grant_type: 'authorization_code' }) });
      if (!response.ok) throw invalid();
      const body = await response.json() as { id_token?: unknown };
      if (typeof body.id_token !== 'string' || body.id_token.length > 10000) throw invalid();
      const header = JSON.parse(Buffer.from(body.id_token.split('.')[0] ?? '', 'base64url').toString()) as { alg?: string };
      if (header.alg !== 'RS256') throw invalid();
      if (!cached || cached.expiresAt <= Date.now()) {
        const certificates = await request('https://www.googleapis.com/oauth2/v1/certs', { signal: AbortSignal.timeout(10000) });
        if (!certificates.ok) throw unavailable();
        const certs = z.record(z.string(), z.string().min(1)).parse(await certificates.json());
        const seconds = Number(certificates.headers.get('cache-control')?.match(/(?:^|,)\s*max-age=(\d+)/)?.[1] ?? 0);
        cached = { certs, expiresAt: Date.now() + Math.min(seconds, 3600) * 1000 };
      }
      const payload = (await client.verifySignedJwtWithCertsAsync(body.id_token, cached.certs, config.clientId, ['https://accounts.google.com', 'accounts.google.com'], 7200)).getPayload();
      if (!payload) throw invalid();
      return payload as unknown as Record<string, unknown>;
    } catch (error) { if (error instanceof AppError) throw error; throw unavailable(); }
  } };
}

export function createGoogleAuthService({ config, provider, namespace = 'visit:google', now = Date.now, ready = ensureRedisReady }: { config?: GoogleConfig; provider?: GoogleProvider; namespace?: string; now?: () => number; ready?: () => Promise<void> }) {
  const key = (kind: string, value: string) => `${namespace}:${kind}:${tokenDigest(value)}`;
  const storage = async <T>(operation: () => Promise<T>) => { try { await ready(); return await operation(); } catch (error) { if (error instanceof AppError) throw error; throw unavailable(); } };
  async function throttle(ip: string, kind: string, maximum = 30) {
    await storage(async () => {
      const count = await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],900) end; return n", 1, key(`limit:${kind}`, ip));
      if (Number(count) > maximum) throw new AppError(429, 'RATE_LIMITED', 'Please wait before trying Google sign-in again.');
    });
  }
  async function read<T extends { expiresAt: number }>(kind: string, token: string) {
    if (!opaque.test(token)) throw invalid();
    const raw = await storage(() => redis.get(key(kind, token)));
    if (!raw) throw invalid();
    const record = JSON.parse(raw) as T;
    if (record.expiresAt <= now()) throw invalid();
    return { record, raw };
  }
  async function consume(kind: string, token: string, raw: string) {
    const removed = await storage(() => redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end; return 0", 1, key(kind, token), raw));
    if (!removed) throw invalid();
  }
  function configured() { if (!config || !provider) throw new AppError(503, 'GOOGLE_NOT_CONFIGURED', 'Google sign-in is not available yet.'); return config; }
  async function recent(actor?: AuthenticatedSession, expected?: Proof) {
    if (!actor) throw new AppError(401, 'REAUTH_REQUIRED', 'Sign in again before linking Google.');
    await validateAuthenticatedSession(actor);
    if (actor.authenticatedAt.getTime() > now() || now() - actor.authenticatedAt.getTime() > 300000) throw new AppError(401, 'REAUTH_REQUIRED', 'Sign in again before linking Google.');
    if (expected && (expected.identityId !== actor.identity.id || expected.sessionId !== actor.sessionId)) throw new AppError(403, 'LINK_ACCOUNT_MISMATCH', 'Restart linking from the account you signed in to.');
    return actor;
  }
  function destination(proof: Proof, data: Record<string, string>) {
    const settings = configured();
    const uri = proof.platform === 'web' ? `${settings.webOrigin}/auth/google` : settings.nativeReturnUrl!;
    const target = new URL(uri);
    target.hash = new URLSearchParams({ ...data, ...(proof.clientState ? { state: proof.clientState } : {}) }).toString();
    return target.toString();
  }
  async function grant(input: { grant: string; verifier?: string | undefined }, binding: string | undefined, ip: string, actor?: AuthenticatedSession, burn = false) {
    configured(); await throttle(ip, 'grant', 60);
    const { record, raw } = await read<Grant>('grant', input.grant);
    if (record.platform === 'web') {
      if (!binding || !equal(tokenDigest(binding), record.bindingHash)) throw invalid();
    } else if (!input.verifier || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier) || !record.appChallenge || !equal(s256(input.verifier), record.appChallenge)) throw invalid();
    if (record.intent === 'link') await recent(actor, record);
    if (burn) await consume('grant', input.grant, raw);
    return record;
  }
  return {
    enabled: Boolean(config && provider), nativeEnabled: Boolean(config?.nativeReturnUrl && provider),
    async begin(input: { platform: 'web' | 'native'; intent: 'login' | 'link'; challenge?: string | undefined; clientState?: string | undefined; consent?: boolean | undefined }, ip: string, actor?: AuthenticatedSession) {
      const settings = configured(); await throttle(ip, 'start', 15);
      if (input.platform === 'native' && (!settings.nativeReturnUrl || !input.challenge || !opaque.test(input.challenge) || !input.clientState || !opaque.test(input.clientState))) throw new AppError(400, 'VALIDATION_ERROR', 'Native Google sign-in is not configured or its proof is missing.');
      if (input.platform === 'web' && (input.challenge || input.clientState)) throw new AppError(400, 'VALIDATION_ERROR', 'Use the web authorization flow.');
      const identity = input.intent === 'link' ? await recent(actor) : undefined;
      if (input.intent === 'link' && input.consent !== true) throw new AppError(400, 'LINK_CONSENT_REQUIRED', 'Confirm that you want to link Google.');
      const state = newOpaqueToken(), binding = newOpaqueToken(), verifier = newOpaqueToken(), nonce = newOpaqueToken();
      const proof: Challenge = { platform: input.platform, intent: input.intent, expiresAt: now() + 600000, bindingHash: tokenDigest(binding), verifier, nonce, ...(identity ? { identityId: identity.identity.id, sessionId: identity.sessionId } : {}), ...(input.platform === 'native' ? { appChallenge: input.challenge!, clientState: input.clientState! } : {}) };
      const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorization.search = new URLSearchParams({ client_id: settings.clientId, redirect_uri: settings.callbackUrl, response_type: 'code', scope: 'openid email', state, nonce, code_challenge: s256(verifier), code_challenge_method: 'S256', prompt: 'select_account' }).toString();
      await storage(() => redis.set(key('state', state), JSON.stringify(proof), 'PX', 600000));
      if (input.platform === 'web') return { authorizationUrl: authorization.toString(), binding };
      const ticket = newOpaqueToken();
      await storage(() => redis.set(key('launch', ticket), JSON.stringify({ authorizationUrl: authorization.toString(), binding, expiresAt: proof.expiresAt }), 'PX', 600000));
      const launch = new URL('/api/auth/google/authorize', settings.callbackUrl); launch.searchParams.set('ticket', ticket);
      return { authorizationUrl: launch.toString(), nativeReturnUrl: settings.nativeReturnUrl! };
    },
    async authorize(ticket: string, ip: string) {
      configured(); await throttle(ip, 'launch');
      const { record, raw } = await read<{ authorizationUrl: string; binding: string; expiresAt: number }>('launch', ticket);
      await consume('launch', ticket, raw); return record;
    },
    async callback(input: { state: string; code?: string | undefined; error?: string | undefined }, binding: string | undefined, ip: string) {
      configured(); await throttle(ip, 'callback');
      const { record, raw } = await read<Challenge>('state', input.state);
      if (!binding || !equal(tokenDigest(binding), record.bindingHash)) throw invalid();
      await consume('state', input.state, raw);
      if (input.error || !input.code) return destination(record, { status: input.error === 'access_denied' ? 'cancelled' : 'failed' });
      try {
        const payload = await provider!.exchange({ code: input.code, verifier: record.verifier, redirectUri: config!.callbackUrl });
        const claim = validateGoogleClaims(payload, config!.clientId, record.nonce, now());
        const receipt = newOpaqueToken();
        const proof: Grant = { platform: record.platform, intent: record.intent, bindingHash: record.bindingHash, expiresAt: now() + 120000, ...claim, ...(record.identityId ? { identityId: record.identityId, sessionId: record.sessionId! } : {}), ...(record.appChallenge ? { appChallenge: record.appChallenge, clientState: record.clientState! } : {}) };
        await storage(() => redis.set(key('grant', receipt), JSON.stringify(proof), 'PX', 120000));
        return destination(record, { grant: receipt });
      } catch { return destination(record, { status: 'failed' }); }
    },
    async preview(input: { grant: string; verifier?: string | undefined }, binding: string | undefined, ip: string, actor?: AuthenticatedSession) {
      const proof = await grant(input, binding, ip, actor);
      return { email: proof.email, intent: proof.intent };
    },
    async finish(input: { grant: string; verifier?: string | undefined; consent?: boolean | undefined }, binding: string | undefined, ip: string, actor?: AuthenticatedSession) {
      const proof = await grant(input, binding, ip, actor);
      if (proof.intent === 'link' && input.consent !== true) throw new AppError(400, 'LINK_CONSENT_REQUIRED', 'Confirm that you want to link this Google account.');
      await grant(input, binding, ip, actor, true);
      const hash = tokenDigest(`google:${input.grant}`), token = newOpaqueToken();
      try {
        return await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`google:${proof.subject}`}, 0))::text`;
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email:${proof.email}`}, 0))::text`;
          if (await tx.googleAuthProof.findUnique({ where: { hash } })) throw invalid();
          const linked = await tx.externalIdentity.findUnique({ where: { provider_subject: { provider: 'google', subject: proof.subject } } });
          let identityId: string;
          if (proof.intent === 'link') {
            const family = await tx.session.findUnique({ where: { id: proof.sessionId! }, select: { familyId: true } });
            if (!family) throw invalid();
            // Same family mutex as rotation/logout: recheck current authorization
            // after acquiring it, so revocation cannot race a new login-method link.
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${family.familyId}, 0))::text`;
            const session = await tx.session.findFirst({ where: { id: proof.sessionId!, identityId: proof.identityId!, revokedAt: null, expiresAt: { gt: new Date(now()) }, authenticatedAt: { gte: new Date(now() - 300000), lte: new Date(now()) } } });
            if (!session) throw new AppError(401, 'REAUTH_REQUIRED', 'Sign in again before linking Google.');
            if (linked) throw conflict('This Google account is already linked.');
            const owner = await tx.identity.findUnique({ where: { email: proof.email } });
            if (owner && owner.id !== proof.identityId) throw conflict('Sign in to the existing account for this address before linking.');
            identityId = proof.identityId!;
          } else if (linked) identityId = linked.identityId;
          else {
            if (await tx.identity.findUnique({ where: { email: proof.email } })) throw new AppError(409, 'LINK_REQUIRED', 'Sign in to your existing account, then explicitly link Google in account settings.');
            identityId = (await tx.identity.create({ data: { email: proof.email, emailVerifiedAt: new Date(now()) } })).id;
          }
          if (!linked) await tx.externalIdentity.create({ data: { identityId, provider: 'google', subject: proof.subject, email: proof.email } });
          await tx.googleAuthProof.create({ data: { hash, identityId, intent: proof.intent } });
          if (proof.intent === 'link') return { identityId, linked: true as const };
          await tx.session.create({ data: { identityId, tokenHash: tokenDigest(token), authenticationProofHash: hash, expiresAt: sessionExpiry(new Date(now())) } });
          return { identityId, sessionToken: token };
        }, { maxWait: 5000, timeout: 5000 });
      } catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw conflict('This Google proof or identity has already been used. Start again.'); throw error; }
    },
  };
}
