import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { prisma } from '../src/db/client.js';
import { AppError } from '../src/http/errors.js';
import { newOpaqueToken, rotateSession, tokenDigest, authenticate, revokeSessionFamily } from '../src/security/sessions.js';
import type { FastifyRequest } from 'fastify';

test('concurrent refresh/replay/logout are serialized per login family and preserve other devices', async () => {
  const identity = await prisma.identity.create({ data: { email: `session-race-${randomUUID()}@example.test` } });
  const create = async () => {
    const token = newOpaqueToken();
    const row = await prisma.session.create({ data: { identityId: identity.id, tokenHash: tokenDigest(token), authenticatedAt: new Date(Date.now() - 86400000), expiresAt: new Date(Date.now() + 60000) } });
    return { token, row };
  };
  const denied = (error: unknown) => error instanceof AppError && error.statusCode === 401;
  const request = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as FastifyRequest;
  try {
    const expiredAccess = await create();
    await prisma.session.update({ where: { id: expiredAccess.row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await assert.rejects(authenticate(request(expiredAccess.token)), denied);
    const recovered = await rotateSession(expiredAccess.token);
    assert.ok(await authenticate(request(recovered.token)), 'expired access can rotate within the absolute refresh window');
    assert.equal(recovered.session.refreshExpiresAt.toISOString(), expiredAccess.row.refreshExpiresAt.toISOString());
    const otherDevice = await create();
    const original = await create();
    const results = await Promise.allSettled([rotateSession(original.token), rotateSession(original.token)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected' && denied(result.reason)).length, 1);
    assert.equal(await prisma.session.count({ where: { familyId: original.row.familyId, revokedAt: null } }), 0, 'concurrent reuse revokes the winning replacement too');
    assert.ok(await authenticate(request(otherDevice.token)), 'other login family survives');
    const fresh = await create();
    const rotated = await rotateSession(fresh.token);
    assert.equal(rotated.session.familyId, fresh.row.familyId);
    assert.equal(rotated.session.authenticatedAt.toISOString(), fresh.row.authenticatedAt.toISOString(), 'refresh is not recent authentication');
    assert.equal(rotated.session.tokenHash, tokenDigest(rotated.token));
    await assert.rejects(authenticate(request(fresh.token)), denied);
    const context = await authenticate(request(rotated.token));
    const race = await Promise.allSettled([rotateSession(rotated.token), revokeSessionFamily(context)]);
    assert.equal(race[1]!.status, 'fulfilled');
    assert.equal(await prisma.session.count({ where: { familyId: fresh.row.familyId, revokedAt: null } }), 0);
    await assert.rejects(rotateSession(rotated.token), denied);
    assert.ok(await authenticate(request(otherDevice.token)));
    await assert.rejects(revokeSessionFamily({ ...context }), denied);
  } finally { await prisma.identity.delete({ where: { id: identity.id } }); await prisma.$disconnect(); }
});
