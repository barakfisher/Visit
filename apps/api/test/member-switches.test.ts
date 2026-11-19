import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { INVITATION_ALREADY_MEMBER, INVITATION_UNAVAILABLE, SWITCHES_ACT_NEEDS_SEE } from '../src/repositories/business-access.js';
import { MEMBER_PRESETS, switchesOf, type MemberSwitches } from '../src/security/business-permissions.js';
import { actors, createTwoTenantFixture } from './support/two-tenant.js';

after(async () => { redis.disconnect(); await prisma.$disconnect(); });

type Actor = typeof actors[number];
const SEE_ONLY: MemberSwitches = { ...MEMBER_PRESETS.STAFF, seeAllCalendars: true };

// Worker access slice 5 (decisions.md, "Switches"): only the owner changes switches, on the member's card, and nobody
// changes their own. North's owner is `north`; `dual` is a manager (all four on) in both businesses; `worker` is linked
// to north's row; `staff` is an unlinked member; `pending` is an owner awaiting approval; `south` owns the other business.
test('only the owner changes a member\'s switches, never their own, and the next request uses them', async t => {
  const app = await createApp();
  const fixture = await createTwoTenantFixture();
  const [north, south] = fixture.businesses.map(b => b.id) as [string, string];
  const person = (actor: Actor) => fixture.people[actors.indexOf(actor)]!.id;
  const membership = (actor: Actor, businessId = north) => prisma.membership.findUniqueOrThrow({ where: { identityId_businessId: { identityId: person(actor), businessId } } });
  const put = async (actor: Actor, target: Actor, body: object, { businessId = north, targetBusiness = businessId } = {}) => {
    const id = (await membership(target, targetBusiness)).id;
    return app.inject({ method: 'PUT', url: `/v1/provider/businesses/${businessId}/members/${id}/switches`, headers: fixture.headers(actor), payload: body });
  };
  const status = async (actor: Actor, url: string) => (await app.inject({ url, headers: fixture.headers(actor) })).statusCode;
  const team = async (actor: Actor) => (await app.inject({ url: `/v1/provider/businesses/${north}/team`, headers: fixture.headers(actor) })).json();
  const unchanged = async () => ({ owner: switchesOf(await membership('north')), dual: switchesOf(await membership('dual')), worker: switchesOf(await membership('worker')), staff: switchesOf(await membership('staff')) });
  try {
    await t.test('the owner sets a worker\'s switches; the change is audited and opens the routes at once', async () => {
      assert.equal(await status('worker', `/v1/provider/businesses/${north}/bookings`), 403);
      const response = await put('north', 'worker', SEE_ONLY);
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(response.json().switches, SEE_ONLY);
      assert.deepEqual(switchesOf(await membership('worker')), SEE_ONLY);
      assert.equal(await status('worker', `/v1/provider/businesses/${north}/bookings`), 200, 'see opens the whole agenda on the next read');
      const event = await prisma.businessAccessEvent.findFirstOrThrow({ where: { businessId: north, action: 'SWITCHES_CHANGED' } });
      assert.deepEqual([event.actorIdentityId, event.subjectIdentityId, event.switches], [person('north'), person('worker'), { before: MEMBER_PRESETS.STAFF, after: SEE_ONLY }]);
      assert.equal((await put('north', 'worker', MEMBER_PRESETS.STAFF)).statusCode, 200);
      assert.equal(await status('worker', `/v1/provider/businesses/${north}/bookings`), 403, 'and turning it off closes it');
      // The owner may also make anyone a manager, and back.
      assert.equal((await put('north', 'staff', MEMBER_PRESETS.MANAGER)).statusCode, 200);
      assert.equal((await put('north', 'staff', MEMBER_PRESETS.STAFF)).statusCode, 200);
    });

    await t.test('nobody else changes switches: not a manager, a worker, an outsider or another business\'s owner', async () => {
      const before = await unchanged();
      for (const [actor, target] of [['dual', 'worker'], ['dual', 'staff'], ['worker', 'staff'], ['staff', 'worker'], ['outsider', 'worker'], ['pending', 'worker'], ['south', 'worker']] as [Actor, Actor][]) {
        const response = await put(actor, target, MEMBER_PRESETS.MANAGER);
        assert.equal(response.statusCode, 403, `${actor} on ${target}: ${response.body}`);
      }
      assert.deepEqual(await unchanged(), before);
    });

    await t.test('nobody changes their own, the owner included, and nobody changes the owner\'s', async () => {
      const before = await unchanged();
      for (const actor of ['north', 'dual', 'worker', 'staff'] as Actor[]) {
        const response = await put(actor, actor, actor === 'worker' || actor === 'staff' ? MEMBER_PRESETS.MANAGER : MEMBER_PRESETS.STAFF);
        assert.equal(response.statusCode, 403, `${actor}: ${response.body}`);
      }
      assert.equal((await put('dual', 'north', MEMBER_PRESETS.STAFF)).statusCode, 403);
      assert.deepEqual(await unchanged(), before);
      assert.deepEqual(before.owner, MEMBER_PRESETS.MANAGER);
    });

    await t.test('a member of another business reads as not found, and a removed member too', async () => {
      // South's membership of `dual`, through north's URL.
      const foreign = await membership('dual', south);
      const response = await app.inject({ method: 'PUT', url: `/v1/provider/businesses/${north}/members/${foreign.id}/switches`, headers: fixture.headers('north'), payload: MEMBER_PRESETS.STAFF });
      assert.equal(response.statusCode, 404);
      assert.deepEqual(switchesOf(await membership('dual', south)), MEMBER_PRESETS.MANAGER);
      await prisma.membership.update({ where: { id: (await membership('staff')).id }, data: { status: 'REVOKED' } });
      assert.equal((await put('north', 'staff', SEE_ONLY)).statusCode, 404);
      await prisma.membership.update({ where: { id: (await membership('staff')).id }, data: { status: 'ACTIVE' } });
    });

    await t.test('acting on other calendars needs seeing them, and the body names all four exactly', async () => {
      const before = await unchanged();
      const refused = await put('north', 'worker', { ...MEMBER_PRESETS.STAFF, actOnAllCalendars: true });
      assert.equal(refused.statusCode, 400); assert.equal(refused.json().error.code, SWITCHES_ACT_NEEDS_SEE);
      for (const body of [{ seeAllCalendars: true }, { ...MEMBER_PRESETS.STAFF, role: 'OWNER' }, { ...MEMBER_PRESETS.STAFF, manageTeam: 'yes' }])
        assert.equal((await put('north', 'worker', body)).statusCode, 400, JSON.stringify(body));
      assert.deepEqual(await unchanged(), before);
    });

    await t.test('changing switches needs a recent sign-in', async () => {
      await prisma.session.updateMany({ where: { identityId: person('north') }, data: { authenticatedAt: new Date(Date.now() - 24 * 3600000) } });
      const stale = await put('north', 'worker', SEE_ONLY);
      assert.deepEqual([stale.statusCode, stale.json().error.code], [401, 'REAUTH_REQUIRED']);
      await prisma.session.updateMany({ where: { identityId: person('north') }, data: { authenticatedAt: new Date() } });
      assert.deepEqual(switchesOf(await membership('worker')), MEMBER_PRESETS.STAFF);
    });

    await t.test('the database keeps the owner at everything and refuses acting without seeing', async () => {
      const owner = await membership('north');
      await prisma.membership.update({ where: { id: owner.id }, data: MEMBER_PRESETS.STAFF });
      assert.deepEqual(switchesOf(await membership('north')), MEMBER_PRESETS.MANAGER);
      await prisma.$executeRaw`UPDATE "Membership" SET "manageTeam" = false WHERE id = ${owner.id}`;
      assert.deepEqual(switchesOf(await membership('north')), MEMBER_PRESETS.MANAGER);
      await assert.rejects(prisma.membership.update({ where: { id: (await membership('worker')).id }, data: { actOnAllCalendars: true } }), /Membership_act_needs_see_check/);
      await assert.rejects(prisma.membership.create({ data: { identityId: person('worker'), businessId: north, role: 'MEMBER', status: 'ACTIVE' } }), (error: { code?: string }) => error.code === 'P2002', 'one membership per person per business');
    });

    await t.test('the team list gives each viewer the answers the writes check', async () => {
      const owner = await team('north');
      assert.equal(owner.canChangeSwitches, true);
      assert.deepEqual(owner.invitablePresets, ['STAFF', 'MANAGER']);
      const card = (list: { members: { identityId: string; editable: boolean; removable: boolean; switches: MemberSwitches }[] }, actor: Actor) => list.members.find(member => member.identityId === person(actor))!;
      assert.deepEqual([card(owner, 'worker').editable, card(owner, 'dual').editable, card(owner, 'north').editable], [true, true, false]);
      assert.deepEqual(card(owner, 'dual').switches, MEMBER_PRESETS.MANAGER);
      const manager = await team('dual');
      assert.equal(manager.canChangeSwitches, false);
      assert.deepEqual(manager.invitablePresets, ['STAFF']);
      assert.ok(manager.members.every((member: { editable: boolean }) => !member.editable));
      assert.deepEqual([card(manager, 'worker').removable, card(manager, 'dual').removable, card(manager, 'north').removable], [true, false, false]);
    });

    await t.test('a calendar invitation for an active member links the calendar and keeps their switches; without one it is refused', async () => {
      const row = await prisma.staff.create({ data: { businessId: north, displayName: 'QA manager row' } });
      const invite = async (staffId?: string) => {
        const response = await app.inject({ method: 'POST', url: `/v1/provider/businesses/${north}/invitations`, headers: fixture.headers('north'), payload: { role: 'STAFF', channel: 'email', recipient: `qa-${fixture.run}-dual@example.test`, ...(staffId ? { staffId } : {}) } });
        assert.equal(response.statusCode, 200, response.body);
        return new URL(response.json().url).hash.slice('#invite='.length);
      };
      const accept = (token: string) => app.inject({ method: 'POST', url: '/v1/business-invitations/accept', headers: fixture.headers('dual'), payload: { token } });
      const plain = await accept(await invite());
      assert.equal(plain.statusCode, 409); assert.equal(plain.json().error.code, INVITATION_ALREADY_MEMBER);
      const linked = await accept(await invite(row.id));
      assert.equal(linked.statusCode, 200, linked.body);
      const after = await membership('dual');
      assert.deepEqual([after.staffId, switchesOf(after)], [row.id, MEMBER_PRESETS.MANAGER]);
      // The audit names what the member holds, not the invitation's preset.
      const joined = await prisma.businessAccessEvent.findFirstOrThrow({ where: { membershipId: after.id, action: 'JOINED' }, orderBy: { createdAt: 'desc' } });
      assert.deepEqual([joined.role, joined.switches], ['MEMBER', MEMBER_PRESETS.MANAGER]);
      await prisma.membership.update({ where: { id: after.id }, data: { staffId: null } });
    });

    await t.test('the agenda says where each member may act, apart from what they see', async () => {
      const agenda = async (actor: Actor) => {
        const response = await app.inject({ url: `/api/provider/agenda?businessId=${north}&date=2026-12-01`, headers: fixture.headers(actor) });
        assert.equal(response.statusCode, 200, `${actor}: ${response.body}`);
        return response.json();
      };
      const linked = (await membership('worker')).staffId!;
      assert.deepEqual((await agenda('north')).act, { all: true, staffId: null });
      assert.deepEqual((await agenda('dual')).act, { all: true, staffId: null });
      assert.deepEqual((await agenda('worker')).act, { all: false, staffId: linked }, 'a worker acts on their own row');
      assert.equal((await put('north', 'worker', SEE_ONLY)).statusCode, 200);
      try {
        // Seeing everything does not widen acting, and the profile still names their calendar so they can add on it.
        const seen = await agenda('worker');
        assert.deepEqual(seen.act, { all: false, staffId: linked });
        assert.ok(seen.staff.length > 1, 'the whole business is visible');
        const profile = (await app.inject({ url: '/api/auth/me', headers: fixture.headers('worker') })).json().profile;
        assert.equal(profile.businesses.find((entry: { id: string }) => entry.id === north).calendar.id, linked);
        assert.equal((await put('north', 'staff', SEE_ONLY)).statusCode, 200);
        assert.equal((await agenda('staff')).act, null, 'an unlinked member who only sees acts nowhere');
      } finally {
        await put('north', 'worker', MEMBER_PRESETS.STAFF);
        await put('north', 'staff', MEMBER_PRESETS.STAFF);
      }
    });

    await t.test('a manager neither cancels nor replaces the owner\'s calendar invitation', async () => {
      const row = await prisma.staff.create({ data: { businessId: north, displayName: 'QA new row' } });
      const payload = { role: 'STAFF', channel: 'email', recipient: `qa-${fixture.run}-newcomer@example.test` };
      const owner = await app.inject({ method: 'POST', url: `/v1/provider/businesses/${north}/invitations`, headers: fixture.headers('north'), payload: { ...payload, staffId: row.id } });
      assert.equal(owner.statusCode, 200, owner.body);
      const id = owner.json().id as string;
      const revoke = await app.inject({ method: 'DELETE', url: `/v1/provider/businesses/${north}/invitations/${id}`, headers: fixture.headers('dual') });
      assert.equal(revoke.statusCode, 403);
      const plain = await app.inject({ method: 'POST', url: `/v1/provider/businesses/${north}/invitations`, headers: fixture.headers('dual'), payload });
      assert.equal(plain.statusCode, 200, plain.body);
      assert.equal((await prisma.businessInvitation.findUniqueOrThrow({ where: { id } })).revokedAt, null, 'the owner\'s link stays live');
      // An inviter who no longer counts (team rights, but no "see" and no calendar) leaves links that open nothing.
      const token = new URL(plain.json().url).hash.slice('#invite='.length);
      const preview = () => app.inject({ method: 'POST', url: '/v1/business-invitations/preview', headers: fixture.headers('worker'), payload: { token } });
      assert.equal((await preview()).json().error.code, 'INVITATION_RECIPIENT', 'while the inviter counts, only the recipient check refuses');
      const dual = await membership('dual');
      await prisma.membership.update({ where: { id: dual.id }, data: { ...MEMBER_PRESETS.STAFF, manageTeam: true } });
      try { assert.equal((await preview()).json().error.code, INVITATION_UNAVAILABLE); }
      finally { await prisma.membership.update({ where: { id: dual.id }, data: MEMBER_PRESETS.MANAGER }); }
    });
  } finally {
    await prisma.businessAccessEvent.deleteMany({ where: { businessId: { in: fixture.businesses.map(b => b.id) } } });
    await prisma.businessInvitation.deleteMany({ where: { businessId: { in: fixture.businesses.map(b => b.id) } } });
    await fixture.reset();
    await app.close();
    if (redis.status === 'ready') await redis.del(...fixture.people.map(p => `visit:invitation-limit:${p.id}`));
  }
});
