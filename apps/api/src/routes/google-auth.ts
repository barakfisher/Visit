import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../env.js';
import { AppError } from '../http/errors.js';
import { authenticate, issueSessionToken } from '../security/sessions.js';
import { createGoogleAuthService, createGoogleProvider, type GoogleConfig } from '../security/google-auth.js';

const config: GoogleConfig | undefined = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_CALLBACK_URL ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, callbackUrl: env.GOOGLE_CALLBACK_URL, webOrigin: new URL(env.WEB_APP_URL).origin, ...(env.GOOGLE_NATIVE_RETURN_URL ? { nativeReturnUrl: env.GOOGLE_NATIVE_RETURN_URL } : {}) } : undefined;
export const googleAuthService = createGoogleAuthService({ ...(config ? { config, provider: createGoogleProvider(config) } : {}) });
const cookieName = () => env.NODE_ENV === 'production' ? '__Host-visit_google_binding' : 'visit_google_binding';
function binding(request: FastifyRequest) {
  const value = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName()}=`))?.slice(cookieName().length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
function setBinding(reply: FastifyReply, token: string, age = 600) { reply.header('set-cookie', `${cookieName()}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${age}${env.NODE_ENV === 'production' ? '; Secure' : ''}`); }
async function optionalActor(request: FastifyRequest) {
  try { return await authenticate(request); } catch (error) { if (error instanceof AppError && error.statusCode === 401) return undefined; throw error; }
}
export async function registerGoogleRoutes(app: FastifyInstance, { google = googleAuthService }: { google?: ReturnType<typeof createGoogleAuthService> } = {}) {
  app.post('/api/auth/google/start', async (request, reply) => {
    const input = z.strictObject({ platform: z.enum(['web', 'native']), intent: z.enum(['login', 'link']), challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(), clientState: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(), consent: z.boolean().optional() }).parse(request.body);
    const result = await google.begin(input, request.ip, input.intent === 'link' ? await authenticate(request) : undefined);
    if (result.binding) setBinding(reply, result.binding);
    const { binding: _binding, ...safe } = result;
    return safe;
  });
  app.get('/api/auth/google/authorize', async (request, reply) => {
    const input = z.strictObject({ ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).parse(request.query);
    const launch = await google.authorize(input.ticket, request.ip);
    setBinding(reply, launch.binding); reply.header('Referrer-Policy', 'no-referrer');
    return reply.redirect(launch.authorizationUrl);
  });
  app.get('/api/auth/google/callback', async (request, reply) => {
    const input = z.object({ state: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code: z.string().min(1).max(4096).optional(), error: z.string().min(1).max(120).optional() }).parse(request.query);
    const destination = await google.callback(input, binding(request), request.ip);
    reply.header('Referrer-Policy', 'no-referrer'); return reply.redirect(destination);
  });
  const grantInput = z.strictObject({ grant: z.string().regex(/^[A-Za-z0-9_-]{43}$/), verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/).optional() });
  app.post('/api/auth/google/preview', async (request) => google.preview(grantInput.parse(request.body), binding(request), request.ip, await optionalActor(request)));
  app.post('/api/auth/google', async (request, reply) => {
    const input = grantInput.extend({ consent: z.boolean().optional() }).parse(request.body);
    const result = await google.finish(input, binding(request), request.ip, await optionalActor(request));
    // Preserve the Visit session Set-Cookie when clearing the flow-only cookie.
    reply.header('set-cookie', `${cookieName()}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    return 'sessionToken' in result ? { ...issueSessionToken(reply, request, result.sessionToken), identity: { id: result.identityId } } : { linked: true, identity: { id: result.identityId } };
  });
}
