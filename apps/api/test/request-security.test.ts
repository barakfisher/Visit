import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { AppError } from '../src/http/errors.js';
import { registerRequestSecurity } from '../src/security/request-security.js';
import { issueSessionToken, readSessionToken } from '../src/security/sessions.js';
import { env } from '../src/env.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

test('unsafe web requests require trusted origin and native/API requests cannot bypass it', async () => {
  const app = Fastify(); let writes = 0;
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : 500).send({ ok: false }));
  registerRequestSecurity(app, 'https://visit.example');
  app.post('/write', () => ({ writes: ++writes }));
  try {
    for (const headers of [
      { origin: 'https://evil.example' }, { origin: 'null' }, { origin: 'https://visit.example.evil.test' },
      { origin: 'https://evil.example', 'x-visit-client': 'native', authorization: 'Bearer test' },
      { cookie: 'visit_session=test', 'content-type': 'application/json' },
      { 'sec-fetch-site': 'cross-site', 'x-visit-client': 'native' },
    ]) assert.equal((await app.inject({ method: 'POST', url: '/write', headers })).statusCode, 403);
    assert.equal(writes, 0);
    assert.equal((await app.inject({ method: 'POST', url: '/write', headers: { origin: 'https://visit.example', cookie: 'visit_session=test' } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/write', headers: { 'x-visit-client': 'native' } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/write', headers: { authorization: 'Bearer test' } })).statusCode, 200);
  } finally { await app.close(); }
});

test('production cookies are host-only, Secure, HttpOnly and SameSite; browser headers cannot request JSON tokens', () => {
  const previous = env.NODE_ENV; env.NODE_ENV = 'production';
  let cookie = '';
  const reply = { header: (_key: string, value: string) => { cookie = value; } } as unknown as FastifyReply;
  try {
    const web = issueSessionToken(reply, { headers: { origin: 'https://visit.example', 'x-visit-client': 'native' } } as unknown as FastifyRequest, 'secret');
    assert.equal('sessionToken' in web, false);
    assert.match(cookie, /^__Host-visit_session=/);
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /; Secure/); assert.match(cookie, /SameSite=Lax/); assert.match(cookie, /Path=\//); assert.doesNotMatch(cookie, /Domain=/);
    const native = issueSessionToken(reply, { headers: { 'x-visit-client': 'native' } } as unknown as FastifyRequest, 'native-secret');
    assert.equal(native.sessionToken, 'native-secret');
    assert.throws(() => readSessionToken({ headers: { cookie: '__Host-visit_session=%FF' } } as unknown as FastifyRequest), (error: unknown) => error instanceof AppError && error.statusCode === 401);
  } finally { env.NODE_ENV = previous; }
});

test('forwarded IPs are ignored unless the direct peer is explicitly trusted', async () => {
  const app = Fastify({ trustProxy: ['127.0.0.1/32'] });
  app.get('/ip', request => ({ ip: request.ip }));
  try {
    const ignored = await app.inject({ url: '/ip', remoteAddress: '198.51.100.1', headers: { 'x-forwarded-for': '203.0.113.10' } });
    assert.equal(ignored.json().ip, '198.51.100.1');
    const trusted = await app.inject({ url: '/ip', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.10' } });
    assert.equal(trusted.json().ip, '203.0.113.10');
  } finally { await app.close(); }
});
