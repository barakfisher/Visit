import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { BusinessPermission, MEMBER_PRESETS, MEMBER_SWITCHES, mayGrant, memberHas, memberPreset, type MemberGrants, type MemberSwitch } from '../src/security/business-permissions.js';
import { createTwoTenantFixture, type actors } from './support/two-tenant.js';

after(async () => { redis.disconnect(); await prisma.$disconnect(); });

const PERMISSIONS = Object.values(BusinessPermission);
const P = BusinessPermission;
const OWNER: MemberGrants = { role: 'OWNER', ...MEMBER_PRESETS.MANAGER };
const MANAGER: MemberGrants = memberPreset('MANAGER');
const WORKER: MemberGrants = memberPreset('STAFF');
/** Every member holds these whatever their switches; the owner alone holds the owner-only ones. */
const EVERY_MEMBER = [P.WORKSPACE, P.OWN_CALENDAR, P.SEARCH_CUSTOMERS];
const OWNER_ONLY = [P.LINK_CALENDARS, P.CHANGE_SWITCHES];
/** The permission each switch opens (worker-access.md, Privileges). */
const OPENS: Record<MemberSwitch, BusinessPermission> = { seeAllCalendars: P.SEE_ALL_CALENDARS, actOnAllCalendars: P.ACT_ON_ALL_CALENDARS, businessSetup: P.BUSINESS_SETUP, manageTeam: P.MANAGE_TEAM };
const only = (name: MemberSwitch): MemberGrants => ({ ...WORKER, [name]: true });

// The presets reproduce the slice 1 table (decisions.md, "Named permissions in place of role lists"): the owner holds
// everything, a manager everything but the owner-only permissions, a worker their workspace, own calendar and search.
test('the presets hold exactly the permissions the roles held, and the owner holds all', () => {
  for (const permission of PERMISSIONS) {
    assert.equal(memberHas(OWNER, permission), true, `owner ${permission}`);
    assert.equal(memberHas(MANAGER, permission), !OWNER_ONLY.includes(permission), `manager ${permission}`);
    assert.equal(memberHas(WORKER, permission), EVERY_MEMBER.includes(permission), `worker ${permission}`);
  }
  // Even an owner row stored with switches off holds everything: the role decides, and the database keeps them on.
  for (const permission of PERMISSIONS) assert.equal(memberHas({ ...WORKER, role: 'OWNER' }, permission), true);
});

test('each switch opens its own permission and nothing else', () => {
  for (const name of MEMBER_SWITCHES) for (const permission of PERMISSIONS)
    assert.equal(memberHas(only(name), permission), EVERY_MEMBER.includes(permission) || permission === OPENS[name], `${name} ${permission}`);
});

test('switches are handed out or taken away only by the owner, or a team manager holding strictly more', () => {
  assert.equal(mayGrant(OWNER, MEMBER_PRESETS.MANAGER), true);
  assert.equal(mayGrant(OWNER, MEMBER_PRESETS.STAFF), true);
  assert.equal(mayGrant(MANAGER, MEMBER_PRESETS.STAFF), true);
  assert.equal(mayGrant(MANAGER, MEMBER_PRESETS.MANAGER), false, 'not their own level');
  assert.equal(mayGrant(WORKER, MEMBER_PRESETS.STAFF), false, 'no manage team');
  assert.equal(mayGrant(only('manageTeam'), MEMBER_PRESETS.STAFF), true, 'manage team alone removes a worker');
  assert.equal(mayGrant(only('manageTeam'), only('seeAllCalendars')), false, 'never a switch they lack');
  assert.equal(mayGrant(only('manageTeam'), only('manageTeam')), false, 'never their own level');
  assert.equal(mayGrant({ ...MANAGER, businessSetup: false }, only('businessSetup')), false);
  assert.equal(mayGrant(MANAGER, { ...MEMBER_PRESETS.MANAGER, manageTeam: false }), true);
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
      assert.deepEqual(worker.map(b => [b.id, b.role, b.calendar?.id]), [[north, 'MEMBER', ownRow]]);
      assert.equal((await businesses('dual')).every(b => b.calendar === undefined), true);
    });
  } finally {
    await fixture.reset();
    await app.close();
  }
});

// The check reads the stored switches: turning one on opens exactly its routes, on the next request.
test('each switch alone opens its routes, and an unlinked member opens nothing without "see"', async t => {
  const app = await createApp();
  const fixture = await createTwoTenantFixture();
  const north = fixture.businesses[0]!.id, base = `/v1/provider/businesses/${north}`;
  const otherRow = await prisma.staff.create({ data: { businessId: north, displayName: 'QA other row' } });
  const set = (actor: 'worker' | 'staff', switches: Partial<Record<MemberSwitch, boolean>>) => prisma.membership.updateMany({ where: { businessId: north, identityId: fixture.people[(['north', 'south', 'dual', 'staff', 'pending', 'outsider', 'worker'] as const).indexOf(actor)]!.id }, data: { ...MEMBER_PRESETS.STAFF, ...switches } });
  const status = async (actor: 'worker' | 'staff', url: string, method: 'GET' | 'POST' = 'GET', payload?: object) => (await app.inject({ method, url, headers: fixture.headers(actor), ...(payload ? { payload } : {}) })).statusCode;
  const block = { businessId: north, kind: 'days', fromDate: fixture.date, toDate: fixture.date, staffId: otherRow.id };
  const routes = { see: `${base}/bookings`, setup: `${base}/services`, team: `${base}/team` };
  // 200 opens, 403 or 404 refuses; anything else (a 500) fails the test instead of reading as "closed".
  const answer = (code: number) => { if (code === 200) return true; if (code === 403 || code === 404) return false; throw new Error(`unexpected ${code}`); };
  const opened = async (actor: 'worker' | 'staff') => ({ see: answer(await status(actor, routes.see)), setup: answer(await status(actor, routes.setup)), team: answer(await status(actor, routes.team)) });
  try {
    await t.test('a linked worker', async () => {
      assert.deepEqual(await opened('worker'), { see: false, setup: false, team: false });
      await set('worker', { seeAllCalendars: true });
      assert.deepEqual(await opened('worker'), { see: true, setup: false, team: false });
      assert.ok(REFUSED.includes(await status('worker', '/api/provider/block-time', 'POST', block)), 'seeing is not acting');
      await set('worker', { seeAllCalendars: true, actOnAllCalendars: true });
      assert.ok(await status('worker', '/api/provider/block-time', 'POST', block) < 400, 'acting on another row');
      await set('worker', { businessSetup: true });
      assert.deepEqual(await opened('worker'), { see: false, setup: true, team: false });
      await set('worker', { manageTeam: true });
      assert.deepEqual(await opened('worker'), { see: false, setup: false, team: true });
    });
    await t.test('an unlinked member (the user\'s call: no calendar needs "see")', async () => {
      for (const name of ['businessSetup', 'manageTeam'] as const) {
        await set('staff', { [name]: true });
        assert.deepEqual(await opened('staff'), { see: false, setup: false, team: false }, name);
      }
      await set('staff', { seeAllCalendars: true, businessSetup: true });
      assert.deepEqual(await opened('staff'), { see: true, setup: true, team: false });
    });
  } finally {
    await prisma.timeBlock.deleteMany({ where: { businessId: north, staffId: otherRow.id } });
    await fixture.reset();
    await app.close();
  }
});
