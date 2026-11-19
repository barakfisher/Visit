import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after } from 'node:test';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { tokenDigest } from '../src/security/sessions.js';
import { INVITATION_OWNER_LINK, INVITATION_STAFF_LINKED, INVITATION_STAFF_REMOVED, INVITATION_UNAVAILABLE, STAFF_ALREADY_LINKED } from '../src/repositories/business-access.js';
import { authProfile } from '../src/routes/flow-auth.js';

// Postgres errors Prisma surfaces for a unique index and a foreign key.
const UNIQUE_VIOLATION = { code: 'P2002' }, FOREIGN_KEY_VIOLATION = { code: 'P2003' };
import { STAFF_HAS_APP_ACCESS } from '../src/repositories/provider-settings.js';
import { MEMBER_PRESETS, memberPreset, switchesOf } from '../src/security/business-permissions.js';

after(async () => { redis.disconnect(); await prisma.$disconnect(); });

type Team = { canLinkCalendars: boolean; members: { id: string; identityId: string; role: string; staff: { id: string; displayName: string; membershipId: string } | null }[]; invitations: { id: string; staff: { id: string; displayName: string } | null }[] };

test('an invitation tied to a staff row links the account to that calendar and fails closed', async t => {
  const run = randomUUID();
  const businesses = await Promise.all([0, 1].map(n => prisma.business.create({ data: { name: `Linked ${n}`, slug: `linked-${n}-${run}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } })));
  const [business, other] = businesses as [typeof businesses[number], typeof businesses[number]];
  const names = ['owner', 'manager', 'worker', 'second', 'outsider', 'otherOwner', 'customer'] as const;
  const people = Object.fromEntries(await Promise.all(names.map(async name => [name, await prisma.identity.create({ data: { email: `linked-${name}-${run}@example.test`, emailVerifiedAt: new Date() } })] as const))) as Record<typeof names[number], { id: string; email: string | null }>;
  const ids = Object.values(people).map(person => person.id);
  const tokens = new Map<string, string>();
  for (const id of ids) {
    const token = randomUUID(); tokens.set(id, token);
    await prisma.session.create({ data: { identityId: id, tokenHash: tokenDigest(token), expiresAt: new Date(Date.now() + 600000) } });
  }
  await prisma.membership.createMany({ data: [
    { businessId: business.id, identityId: people.owner.id, role: 'OWNER', status: 'ACTIVE' },
    { businessId: business.id, identityId: people.manager.id, ...memberPreset('MANAGER'), status: 'ACTIVE' },
    { businessId: other.id, identityId: people.otherOwner.id, role: 'OWNER', status: 'ACTIVE' },
  ] });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Cut', durationMinutes: 30 } });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 730, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '08:00', endLocal: '18:00' })) });
  const row = async (displayName: string, businessId = business.id) => {
    const staff = await prisma.staff.create({ data: { businessId, displayName } });
    if (businessId === business.id) {
      await prisma.staffService.create({ data: { businessId, staffId: staff.id, serviceId: service.id } });
      await prisma.staffWeeklyAvailability.create({ data: { businessId, staffId: staff.id, weekday: 1, startLocal: '09:00', endLocal: '17:00' } });
    }
    return staff;
  };
  await row('Anchor');
  const app = await createApp();
  const headers = (id: string) => ({ authorization: `Bearer ${tokens.get(id)}`, 'x-visit-client': 'native' });
  const base = `/v1/provider/businesses/${business.id}`;
  const invite = (staffId: string | undefined, recipient: string, who = people.owner.id, role = 'STAFF', businessId = business.id) =>
    app.inject({ method: 'POST', url: `/v1/provider/businesses/${businessId}/invitations`, headers: headers(who), payload: { role, channel: 'email', recipient, ...(staffId ? { staffId } : {}) } });
  const tokenOf = (response: { json: () => { url: string } }) => new URL(response.json().url).hash.slice('#invite='.length);
  const invitation = (action: 'preview' | 'accept', token: string, who: string) => app.inject({ method: 'POST', url: `/v1/business-invitations/${action}`, headers: headers(who), payload: { token } });
  const team = async () => (await app.inject({ url: `${base}/team`, headers: headers(people.owner.id) })).json<Team>();
  try {
    await t.test('invite with a row, preview names the calendar, a wrong recipient learns nothing, accept links it', async () => {
      const noa = await row('Noa');
      const created = await invite(noa.id, people.worker.email!);
      assert.equal(created.statusCode, 200, created.body);
      assert.equal((await prisma.businessInvitation.findUniqueOrThrow({ where: { id: created.json<{ id: string }>().id } })).staffId, noa.id);
      assert.equal((await team()).invitations.find(item => item.id === created.json<{ id: string }>().id)?.staff?.displayName, 'Noa');
      const token = tokenOf(created);
      const wrong = await invitation('preview', token, people.outsider.id);
      assert.equal(wrong.statusCode, 403); assert.ok(!wrong.body.includes('Noa'));
      assert.equal((await invitation('accept', token, people.outsider.id)).statusCode, 403);
      const preview = await invitation('preview', token, people.worker.id);
      assert.equal(preview.statusCode, 200); assert.equal(preview.json<{ staff: { displayName: string } }>().staff.displayName, 'Noa');
      const accepted = await invitation('accept', token, people.worker.id);
      assert.equal(accepted.statusCode, 200, accepted.body);
      const membership = await prisma.membership.findFirstOrThrow({ where: { businessId: business.id, identityId: people.worker.id, status: 'ACTIVE' } });
      assert.equal(membership.staffId, noa.id); assert.equal(membership.role, 'MEMBER'); assert.deepEqual(switchesOf(membership), MEMBER_PRESETS.STAFF);
      assert.equal((await team()).members.find(member => member.identityId === people.worker.id)?.staff?.id, noa.id);
      // Since slice 3 the link opens the worker's own calendar in provider mode.
      const entry = (await authProfile(people.worker.id)).businesses.find(item => item.id === business.id);
      assert.equal(entry?.role, 'MEMBER'); assert.deepEqual(entry?.switches, MEMBER_PRESETS.STAFF); assert.equal(entry && 'calendar' in entry ? entry.calendar.id : null, noa.id);
    });

    await t.test('a row that already has an account cannot be invited, and a link taken after the invite fails closed', async () => {
      const noa = await prisma.staff.findFirstOrThrow({ where: { businessId: business.id, displayName: 'Noa' } });
      const refused = await invite(noa.id, people.second.email!);
      assert.equal(refused.statusCode, 409); assert.equal(refused.json<{ error: { code: string } }>().error.code, STAFF_ALREADY_LINKED);
      // The worker, already linked to Noa, cannot take a second calendar in the same business.
      const dan = await row('Dan');
      const second = await invite(dan.id, people.worker.email!);
      assert.equal(second.statusCode, 200);
      const blocked = await invitation('accept', tokenOf(second), people.worker.id);
      assert.equal(blocked.statusCode, 409); assert.equal(blocked.json<{ error: { code: string } }>().error.code, INVITATION_STAFF_LINKED);
      // Someone else took Dan between invite and accept.
      const forSecond = await invite(dan.id, people.second.email!);
      // One live link per calendar: the newer invitation replaced the worker's.
      assert.ok((await prisma.businessInvitation.findUniqueOrThrow({ where: { id: second.json<{ id: string }>().id } })).revokedAt);
      await prisma.membership.create({ data: { businessId: business.id, identityId: people.customer.id, ...memberPreset('STAFF'), status: 'ACTIVE', staffId: dan.id } });
      const taken = await invitation('accept', tokenOf(forSecond), people.second.id);
      assert.equal(taken.statusCode, 409); assert.equal(taken.json<{ error: { code: string } }>().error.code, INVITATION_STAFF_LINKED);
      assert.equal(await prisma.membership.count({ where: { businessId: business.id, identityId: people.second.id } }), 0);
      // The database refuses a second active account on one row even if the code were bypassed.
      await assert.rejects(prisma.membership.create({ data: { businessId: business.id, identityId: people.second.id, ...memberPreset('STAFF'), status: 'ACTIVE', staffId: dan.id } }), UNIQUE_VIOLATION);
    });

    await t.test('a removed row fails closed: removal revokes the link, and an archived row is refused at accept', async () => {
      const gal = await row('Gal');
      const pending = await invite(gal.id, people.second.email!);
      assert.equal((await app.inject({ method: 'DELETE', url: `${base}/staff/${gal.id}`, headers: headers(people.owner.id) })).statusCode, 200);
      // The invitation still names it, so the row is archived, not deleted.
      assert.ok((await prisma.staff.findUniqueOrThrow({ where: { id: gal.id } })).archivedAt);
      assert.ok((await prisma.businessInvitation.findUniqueOrThrow({ where: { id: pending.json<{ id: string }>().id } })).revokedAt);
      assert.equal((await invitation('accept', tokenOf(pending), people.second.id)).json<{ error: { code: string } }>().error.code, INVITATION_UNAVAILABLE);
      const lior = await row('Lior');
      const live = await invite(lior.id, people.second.email!);
      await prisma.staff.update({ where: { id: lior.id }, data: { archivedAt: new Date(), active: false } });
      // A wrong recipient still learns nothing about the removed calendar.
      const stranger = await invitation('preview', tokenOf(live), people.outsider.id);
      assert.equal(stranger.statusCode, 403); assert.ok(!stranger.body.includes(INVITATION_STAFF_REMOVED));
      const preview = await invitation('preview', tokenOf(live), people.second.id);
      assert.equal(preview.statusCode, 409); assert.equal(preview.json<{ error: { code: string } }>().error.code, INVITATION_STAFF_REMOVED);
      assert.equal((await invitation('accept', tokenOf(live), people.second.id)).json<{ error: { code: string } }>().error.code, INVITATION_STAFF_REMOVED);
      assert.equal(await prisma.membership.count({ where: { businessId: business.id, identityId: people.second.id } }), 0);
      assert.equal((await invite(lior.id, people.second.email!)).statusCode, 404);
    });

    await t.test("another business's row is not found and cannot be linked", async () => {
      const foreign = await row('Foreign', other.id);
      const response = await invite(foreign.id, people.second.email!);
      assert.equal(response.statusCode, 404);
      assert.equal(await prisma.businessInvitation.count({ where: { staffId: foreign.id } }), 0);
      // The composite key refuses a cross-business link at the database too.
      await assert.rejects(prisma.membership.create({ data: { businessId: business.id, identityId: people.second.id, ...memberPreset('STAFF'), status: 'ACTIVE', staffId: foreign.id } }), FOREIGN_KEY_VIOLATION);
      // The other business's owner cannot link this business's row through their own business.
      const noa = await prisma.staff.findFirstOrThrow({ where: { businessId: business.id, displayName: 'Noa' } });
      assert.equal((await invite(noa.id, people.second.email!, people.otherOwner.id, 'STAFF', other.id)).statusCode, 404);
    });

    await t.test('only the owner links a calendar; a manager invites without one; staff and outsiders cannot', async () => {
      const maya = await row('Maya');
      // The decision "My day for a worker": the app cannot tell which row is the owner's own, so managers link none.
      assert.equal((await invite(maya.id, people.second.email!, people.manager.id)).statusCode, 403);
      assert.equal((await invite(maya.id, people.second.email!, people.manager.id, 'MANAGER')).statusCode, 403);
      assert.equal((await invite(maya.id, people.second.email!, people.worker.id)).statusCode, 403);
      assert.equal((await invite(maya.id, people.second.email!, people.outsider.id)).statusCode, 403);
      assert.equal((await prisma.businessInvitation.count({ where: { staffId: maya.id } })), 0);
      const plain = await invite(undefined, people.second.email!, people.manager.id);
      assert.equal(plain.statusCode, 200, plain.body);
      // A manager's calendar link from before this rule (written as it was stored then) fails closed at accept.
      await prisma.businessInvitation.update({ where: { id: plain.json<{ id: string }>().id }, data: { staffId: maya.id } });
      const accepted = await invitation('accept', tokenOf(plain), people.second.id);
      assert.equal(accepted.statusCode, 409); assert.equal(accepted.json<{ error: { code: string } }>().error.code, INVITATION_UNAVAILABLE);
      assert.equal(await prisma.membership.count({ where: { businessId: business.id, identityId: people.second.id, status: 'ACTIVE' } }), 0);
      assert.equal((await team()).canLinkCalendars, true);
      assert.equal((await app.inject({ url: `${base}/team`, headers: headers(people.manager.id) })).json<{ canLinkCalendars: boolean }>().canLinkCalendars, false);
    });

    await t.test("a manager's new link never replaces an owner's Manager invitation for the same calendar", async () => {
      const lea = await row('Lea');
      const ownerInvite = await invite(lea.id, people.second.email!, people.owner.id, 'MANAGER');
      assert.equal(ownerInvite.statusCode, 200);
      assert.equal((await invite(lea.id, people.outsider.email!, people.manager.id)).statusCode, 403);
      assert.equal((await prisma.businessInvitation.findUniqueOrThrow({ where: { id: ownerInvite.json<{ id: string }>().id } })).revokedAt, null);
      // A Manager invitation that names a calendar links the manager to it.
      assert.equal((await invitation('accept', tokenOf(ownerInvite), people.second.id)).statusCode, 200);
      const linked = await prisma.membership.findFirstOrThrow({ where: { businessId: business.id, identityId: people.second.id, status: 'ACTIVE' } });
      assert.equal(linked.role, 'MEMBER'); assert.deepEqual(switchesOf(linked), MEMBER_PRESETS.MANAGER); assert.equal(linked.staffId, lea.id);
      await prisma.membership.update({ where: { id: linked.id }, data: { status: 'REVOKED' } });
    });

    await t.test('two people accepting links to one calendar at once: one wins, the other is refused', async () => {
      const ron = await row('Ron');
      const first = await invite(ron.id, people.outsider.email!);
      // A second live link for the same row only exists if created directly; the database still allows one account.
      const second = await invite(undefined, people.customer.email!);
      await prisma.businessInvitation.update({ where: { id: second.json<{ id: string }>().id }, data: { staffId: ron.id } });
      const results = await Promise.all([invitation('accept', tokenOf(first), people.outsider.id), invitation('accept', tokenOf(second), people.customer.id)]);
      assert.deepEqual(results.map(r => r.statusCode).sort(), [200, 409]);
      assert.equal(results.find(r => r.statusCode === 409)!.json<{ error: { code: string } }>().error.code, INVITATION_STAFF_LINKED);
      assert.equal(await prisma.membership.count({ where: { businessId: business.id, staffId: ron.id, status: 'ACTIVE' } }), 1);
    });

    await t.test('a revoked link to one calendar can be replaced by an invitation for another', async () => {
      const lea = await prisma.staff.findFirstOrThrow({ where: { businessId: business.id, displayName: 'Lea' } });
      const tal = await row('Tal');
      const moved = await invite(tal.id, people.second.email!, people.owner.id, 'MANAGER');
      assert.equal((await invitation('accept', tokenOf(moved), people.second.id)).statusCode, 200);
      const membership = await prisma.membership.findFirstOrThrow({ where: { businessId: business.id, identityId: people.second.id } });
      assert.equal(membership.status, 'ACTIVE'); assert.equal(membership.staffId, tal.id); assert.notEqual(membership.staffId, lea.id);
      await prisma.membership.update({ where: { id: membership.id }, data: { status: 'REVOKED' } });
    });

    await t.test('an owner is never linked to a calendar, since their access could never be removed', async () => {
      const own = await row('Owner self');
      const response = await invite(own.id, people.owner.email!);
      assert.equal(response.statusCode, 200);
      const refused = await invitation('accept', tokenOf(response), people.owner.id);
      assert.equal(refused.statusCode, 409); assert.equal(refused.json<{ error: { code: string } }>().error.code, INVITATION_OWNER_LINK);
      assert.equal(await prisma.membership.count({ where: { businessId: business.id, staffId: own.id } }), 0);
    });

    await t.test('removing a calendar with app access is refused; removing app access keeps the row, hours and bookings', async () => {
      const noa = await prisma.staff.findFirstOrThrow({ where: { businessId: business.id, displayName: 'Noa' } });
      const startsAt = new Date(Date.now() + 2 * 86400000);
      const booking = await prisma.booking.create({ data: { businessId: business.id, staffId: noa.id, serviceId: service.id, customerId: people.customer.id, serviceName: service.name, status: 'CONFIRMED', idempotencyKey: randomUUID(), startsAt, endsAt: new Date(+startsAt + 1800000), occupiedFrom: startsAt, occupiedUntil: new Date(+startsAt + 1800000) } });
      const refused = await app.inject({ method: 'DELETE', url: `${base}/staff/${noa.id}`, headers: headers(people.owner.id) });
      assert.equal(refused.statusCode, 409); assert.equal(refused.json<{ error: { code: string } }>().error.code, STAFF_HAS_APP_ACCESS);
      const linked = (await team()).members.find(member => member.identityId === people.worker.id)!;
      assert.equal((await app.inject({ method: 'DELETE', url: `${base}/members/${linked.staff!.membershipId}`, headers: headers(people.owner.id) })).statusCode, 200);
      assert.equal(await prisma.membership.count({ where: { businessId: business.id, identityId: people.worker.id, status: 'ACTIVE' } }), 0);
      const kept = await prisma.staff.findUniqueOrThrow({ where: { id: noa.id }, include: { availability: true } });
      assert.equal(kept.archivedAt, null); assert.equal(kept.availability.length, 1);
      assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status, 'CONFIRMED');
      assert.equal((await team()).members.some(member => member.staff?.id === noa.id), false);
      // The calendar can be offered to someone else now.
      assert.equal((await invite(noa.id, people.second.email!)).statusCode, 200);
    });

    await t.test('reactivating a revoked membership with an invitation for no calendar does not revive the old link', async () => {
      const response = await invite(undefined, people.worker.email!);
      assert.equal((await invitation('accept', tokenOf(response), people.worker.id)).statusCode, 200);
      const membership = await prisma.membership.findFirstOrThrow({ where: { businessId: business.id, identityId: people.worker.id } });
      assert.equal(membership.status, 'ACTIVE'); assert.equal(membership.staffId, null);
    });
  } finally {
    await app.close();
    const scope = { businessId: { in: businesses.map(item => item.id) } };
    await prisma.booking.deleteMany({ where: scope });
    await prisma.businessAccessEvent.deleteMany({ where: scope });
    await prisma.businessInvitation.deleteMany({ where: scope });
    await prisma.membership.deleteMany({ where: scope });
    await prisma.business.deleteMany({ where: { id: { in: businesses.map(item => item.id) } } });
    await prisma.session.deleteMany({ where: { identityId: { in: ids } } });
    await prisma.identity.deleteMany({ where: { id: { in: ids } } });
    if (redis.status === 'ready') await redis.del(...ids.map(id => `visit:invitation-limit:${id}`));
  }
});
