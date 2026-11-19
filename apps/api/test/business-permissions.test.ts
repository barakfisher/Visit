import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { BusinessPermission, ROLE_PRIORITY, mayGrantRole, roleHas, rolesWith } from '../src/security/business-permissions.js';
import { createTwoTenantFixture, type actors } from './support/two-tenant.js';

after(async () => { redis.disconnect(); await prisma.$disconnect(); });

const PERMISSIONS = Object.values(BusinessPermission);
const P = BusinessPermission;

// The agreed table (worker-access.md; decisions.md, "My day for a worker"): the owner holds everything, a manager
// everything but linking calendars, a worker their workspace, their own calendar and customer search.
const GRANTS = {
  OWNER: PERMISSIONS,
  MANAGER: PERMISSIONS.filter(permission => permission !== P.LINK_CALENDARS),
  STAFF: [P.WORKSPACE, P.OWN_CALENDAR, P.SEARCH_CUSTOMERS],
} as const;

test('each role holds exactly the permissions of the agreed table', () => {
  for (const permission of PERMISSIONS) {
    for (const role of ROLE_PRIORITY) assert.equal(roleHas(role, permission), (GRANTS[role] as readonly string[]).includes(permission), `${role} ${permission}`);
    assert.deepEqual(rolesWith(permission), ROLE_PRIORITY.filter(role => (GRANTS[role] as readonly string[]).includes(permission)), permission);
  }
  assert.deepEqual(ROLE_PRIORITY, ['OWNER', 'MANAGER', 'STAFF']);
});

test('a role is handed out only by a team manager holding strictly more permissions', () => {
  assert.equal(mayGrantRole('OWNER', 'MANAGER'), true);
  assert.equal(mayGrantRole('OWNER', 'STAFF'), true);
  assert.equal(mayGrantRole('MANAGER', 'STAFF'), true);
  assert.equal(mayGrantRole('MANAGER', 'MANAGER'), false);
  assert.equal(mayGrantRole('MANAGER', 'OWNER'), false);
  assert.equal(mayGrantRole('STAFF', 'STAFF'), false);
});

type Actor = typeof actors[number];
const REFUSED = [403, 404];

test('each permission guards its routes for members of this business only', async t => {
  const app = await createApp();
  const fixture = await createTwoTenantFixture();
  const north = fixture.businesses[0]!.id, ownRow = fixture.staff[0]!.id;
  // A second calendar in north that the worker is not linked to, with an appointment on it.
  const otherRow = await prisma.staff.create({ data: { businessId: north, displayName: 'QA other row' } });
  await prisma.staffService.create({ data: { businessId: north, staffId: otherRow.id, serviceId: fixture.services[0]!.id } });
  const otherBooking = await prisma.booking.create({ data: { businessId: north, customerId: fixture.people[5]!.id, serviceId: fixture.services[0]!.id, staffId: otherRow.id, idempotencyKey: `qa-${fixture.run}-other`, startsAt: new Date(`${fixture.date}T10:00:00Z`), endsAt: new Date(`${fixture.date}T10:30:00Z`), occupiedFrom: new Date(`${fixture.date}T10:00:00Z`), occupiedUntil: new Date(`${fixture.date}T10:30:00Z`), status: 'CONFIRMED' } });
  const base = `/v1/provider/businesses/${north}`;
  const everyone: Actor[] = ['north', 'dual', 'worker', 'staff', 'pending', 'outsider', 'south'];
  // Who may read each route; everyone else is refused. The worker's calendar reads answer for their own row only.
  const reads: Record<string, { urls: string[]; allowed: Actor[] }> = {
    [`${P.SEE_ALL_CALENDARS} or ${P.OWN_CALENDAR}`]: { urls: [`/api/provider/agenda?businessId=${north}&date=${fixture.date}`, `/api/provider/block-time?businessId=${north}`], allowed: ['north', 'dual', 'worker'] },
    [P.SEE_ALL_CALENDARS]: { urls: [`${base}/bookings`], allowed: ['north', 'dual'] },
    [`${P.ACT_ON_ALL_CALENDARS} or ${P.OWN_CALENDAR}`]: { urls: [`${base}/manual-booking-options`], allowed: ['north', 'dual', 'worker'] },
    [P.SEARCH_CUSTOMERS]: { urls: [`${base}/customer-cards?q=qa`], allowed: ['north', 'dual', 'worker'] },
    [P.BUSINESS_SETUP]: { urls: [base, `${base}/services`, `${base}/services/${fixture.services[0]!.id}`, `${base}/booking-policy`, `${base}/staff`, `${base}/availability-rules`, `${base}/publication`, `/api/provider/services?businessId=${north}`], allowed: ['north', 'dual'] },
    [P.MANAGE_TEAM]: { urls: [`${base}/team`], allowed: ['north', 'dual'] },
  };
  try {
    for (const [permission, { urls, allowed }] of Object.entries(reads)) await t.test(`read: ${permission}`, async () => {
      for (const url of urls) for (const actor of everyone) {
        const response = await app.inject({ url, headers: fixture.headers(actor) });
        if (allowed.includes(actor)) assert.ok(response.statusCode < 400, `${actor} ${url}: ${response.statusCode} ${response.body}`);
        else assert.ok(REFUSED.includes(response.statusCode), `${actor} ${url}: ${response.statusCode}`);
      }
    });

    // One refused write per permission. The refused actors never change anything, so the order does not matter.
    const outsiders: Actor[] = ['staff', 'pending', 'outsider', 'south'];
    const day = { businessId: north, kind: 'days', fromDate: fixture.date, toDate: fixture.date };
    const writes: { permission: string; method: 'POST' | 'PUT'; url: string; payload: object; refused: Actor[] }[] = [
      { permission: P.ACT_ON_ALL_CALENDARS, method: 'POST', url: `${base}/bookings/${otherBooking.id}/cancel`, payload: {}, refused: ['worker', ...outsiders] },
      { permission: P.ACT_ON_ALL_CALENDARS, method: 'POST', url: '/api/provider/block-time', payload: { ...day, staffId: otherRow.id }, refused: ['worker', ...outsiders] },
      { permission: P.BUSINESS_SETUP, method: 'POST', url: '/api/provider/block-time', payload: day, refused: ['worker', ...outsiders] },
      { permission: P.BUSINESS_SETUP, method: 'PUT', url: `${base}/booking-policy`, payload: { minimumNoticeMinutes: 0, maximumAdvanceDays: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 }, refused: ['worker', ...outsiders] },
      { permission: P.BUSINESS_SETUP, method: 'POST', url: `${base}/services`, payload: { name: 'Refused', durationMinutes: 30 }, refused: ['worker', ...outsiders] },
      { permission: P.MANAGE_TEAM, method: 'POST', url: `${base}/invitations`, payload: { role: 'STAFF', channel: 'email', recipient: `qa-${fixture.run}-new@example.test` }, refused: ['worker', ...outsiders] },
      { permission: P.LINK_CALENDARS, method: 'POST', url: `${base}/invitations`, payload: { role: 'STAFF', channel: 'email', recipient: `qa-${fixture.run}-new@example.test`, staffId: otherRow.id }, refused: ['dual', 'worker', ...outsiders] },
      { permission: P.OWN_CALENDAR, method: 'POST', url: `${base}/manual-bookings`, payload: { finalConsent: true, idempotencyKey: '00000000-0000-4000-8000-000000000001', serviceId: fixture.services[0]!.id, staffId: otherRow.id, localDate: fixture.date, localTime: '14:00', customerName: 'Refused', customerPhone: '+972500000001', reviewedService: { name: fixture.services[0]!.name, durationMinutes: 30, priceMinor: 5000, currency: 'ILS' } }, refused: ['worker', ...outsiders] },
    ];
    for (const write of writes) await t.test(`write: ${write.permission} ${write.method} ${write.url}`, async () => {
      for (const actor of write.refused) {
        const response = await app.inject({ method: write.method, url: write.url, headers: fixture.headers(actor), payload: write.payload });
        assert.ok(REFUSED.includes(response.statusCode), `${actor}: ${response.statusCode} ${response.body}`);
      }
    });
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: otherBooking.id } })).status, 'CONFIRMED');
    assert.equal(await prisma.timeBlock.count({ where: { businessId: north } }), 1);
    assert.equal(await prisma.service.count({ where: { businessId: north, name: 'Refused' } }), 0);
    assert.equal(await prisma.businessInvitation.count({ where: { businessId: north } }), 0);

    await t.test(P.WORKSPACE, async () => {
      const businesses = async (actor: Actor) => (await app.inject({ url: '/api/auth/me', headers: fixture.headers(actor) })).json().profile.businesses as { id: string; role: string; calendar?: { id: string } }[];
      assert.deepEqual((await businesses('north')).map(b => b.id), [north]);
      assert.deepEqual((await businesses('dual')).map(b => b.id).sort(), fixture.businesses.map(b => b.id).sort());
      assert.deepEqual(await businesses('staff'), []);
      const worker = await businesses('worker');
      assert.deepEqual(worker.map(b => [b.id, b.role, b.calendar?.id]), [[north, 'STAFF', ownRow]]);
      assert.equal((await businesses('dual')).every(b => b.calendar === undefined), true);
    });
  } finally {
    await fixture.reset();
    await app.close();
  }
});
