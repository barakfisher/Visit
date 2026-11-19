import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import test, { after } from 'node:test';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { env } from '../src/env.js';
import { prisma } from '../src/db/client.js';
import { BusinessPermission, mayGrant, permissionWhere, type MemberGrants } from '../src/security/business-permissions.js';
import { countedMembershipWhere } from '../src/security/tenant-context.js';

after(async () => { await prisma.$disconnect(); });

/**
 * Worker access slice 5 done-criterion: the migration from roles to switches changes no one's access on the day
 * (worker-access.md, Build plan item 5). A scratch database is migrated to just before slice 5, filled with every
 * kind of membership the old rules knew, and each person's access is computed by the old rules; then the slice 5
 * migrations run and the same access is computed by the code that ships with them.
 */
const MIGRATIONS = new URL('../prisma/migrations/', import.meta.url);
const SLICE_5 = ['20261120120000_member_role_value', '20261120120100_member_switches'];
const all = readdirSync(MIGRATIONS).filter(name => /^\d{14}_/.test(name)).sort();
const before = all.slice(0, all.indexOf(SLICE_5[0]!));
const sql = (name: string) => readFileSync(new URL(`${name}/migration.sql`, MIGRATIONS), 'utf8');

/** The role table as it was before slice 5 (business-permissions.ts at PR #74), the rules the old data lived under. */
const P = BusinessPermission;
const OLD_PERMISSIONS = [P.WORKSPACE, P.SEE_ALL_CALENDARS, P.ACT_ON_ALL_CALENDARS, P.SEARCH_CUSTOMERS, P.BUSINESS_SETUP, P.MANAGE_TEAM, P.OWN_CALENDAR, P.LINK_CALENDARS];
const OLD_GRANTS: Record<string, readonly string[]> = {
  OWNER: OLD_PERMISSIONS,
  MANAGER: OLD_PERMISSIONS.filter(permission => permission !== P.LINK_CALENDARS),
  STAFF: [P.WORKSPACE, P.OWN_CALENDAR, P.SEARCH_CUSTOMERS],
};
/** Old `countedMembershipWhere`: a Staff membership counted only while linked to a live row. */
const oldCounted = (row: OldRow) => row.role !== 'STAFF' || (row.staffId !== null && !row.staffArchived);
/** Old `mayGrantRole` behind `permittedInvite`, which also decided who may remove whom. */
const oldMayGrant = (actor: string, role: string) => role !== 'OWNER' && OLD_GRANTS[actor]!.includes(P.MANAGE_TEAM) && OLD_GRANTS[role]!.every(p => OLD_GRANTS[actor]!.includes(p)) && OLD_GRANTS[actor]!.length > OLD_GRANTS[role]!.length;
type OldRow = { identityId: string; businessId: string; role: string; status: string; staffId: string | null; staffArchived: boolean; approved: boolean };

function scratchUrl(name: string) {
  const url = new URL(env.DATABASE_URL);
  if (env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]', 'postgres'].includes(url.hostname)) throw new Error('The migration test needs a local, non-production PostgreSQL.');
  url.pathname = `/${name}`; url.search = '';
  return url.toString();
}

test('the switches migration changes no one\'s access, and refuses to guess when a person has two memberships', async t => {
  const name = `visit_switches_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await prisma.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  const db = new pg.Client({ connectionString: scratchUrl(name) });
  await db.connect();
  const migrated = new PrismaClient({ adapter: new PrismaPg({ connectionString: scratchUrl(name) }), log: [] });
  try {
    // A simple-protocol query runs a whole file; each file commits before the next, as `prisma migrate deploy` runs them.
    for (const migration of before) await db.query(sql(migration));

    // Every kind of membership the old rules knew, in an approved business and one awaiting approval.
    await db.query(`INSERT INTO "Business" (id, name, slug, timezone, "approvalStatus", "updatedAt") VALUES ('b-live', 'Live', 'b-live', 'UTC', 'APPROVED', now()), ('b-pending', 'Pending', 'b-pending', 'UTC', 'PENDING', now())`);
    await db.query(`INSERT INTO "Staff" (id, "businessId", "displayName", "archivedAt") VALUES ('row-1', 'b-live', 'One', NULL), ('row-2', 'b-live', 'Two', NULL), ('row-3', 'b-live', 'Three', NULL), ('row-gone', 'b-live', 'Gone', now()), ('row-p', 'b-pending', 'P', NULL)`);
    const people: [string, string, string, string, string | null][] = [
      ['owner', 'b-live', 'OWNER', 'ACTIVE', null], ['old-owner', 'b-live', 'OWNER', 'REVOKED', null],
      ['manager', 'b-live', 'MANAGER', 'ACTIVE', null], ['linked-manager', 'b-live', 'MANAGER', 'ACTIVE', 'row-1'], ['old-manager', 'b-live', 'MANAGER', 'REVOKED', null],
      ['worker', 'b-live', 'STAFF', 'ACTIVE', 'row-2'], ['unlinked', 'b-live', 'STAFF', 'ACTIVE', null], ['archived', 'b-live', 'STAFF', 'ACTIVE', 'row-gone'], ['old-worker', 'b-live', 'STAFF', 'REVOKED', 'row-3'],
      ['applicant', 'b-pending', 'OWNER', 'PENDING', null], ['pending-manager', 'b-pending', 'MANAGER', 'ACTIVE', null], ['pending-worker', 'b-pending', 'STAFF', 'ACTIVE', 'row-p'],
      // The same person in two businesses is two memberships, which slice 5 keeps.
      ['manager', 'b-pending', 'STAFF', 'ACTIVE', null],
    ];
    for (const person of new Set(people.map(([id]) => id))) await db.query(`INSERT INTO "Identity" (id, email, "updatedAt") VALUES ($1, $2, now())`, [person, `${person}-${name}@example.test`]);
    for (const [identityId, businessId, role, status, staffId] of people) await db.query(`INSERT INTO "Membership" (id, "identityId", "businessId", role, status, "staffId") VALUES ($1, $2, $3, $4, $5, $6)`, [`m-${identityId}-${businessId}`, identityId, businessId, role, status, staffId]);
    // A manager's pending Worker invitation made before slice 5 keeps satisfying the invitation check.
    await db.query(`INSERT INTO "BusinessInvitation" (id, "businessId", "inviterIdentityId", "inviterMembershipId", "inviterRole", role, "recipientChannel", "recipientDigest", "recipientHint", "tokenHash", "expiresAt") VALUES ('inv-1', 'b-live', 'manager', 'm-manager-b-live', 'MANAGER', 'STAFF', 'email', $1, 'x***@example.test', $2, now() + interval '1 day')`, ['a'.repeat(64), 'b'.repeat(64)]);

    const old: OldRow[] = (await db.query(`SELECT m."identityId", m."businessId", m.role::text, m.status::text, m."staffId", coalesce(s."archivedAt" IS NOT NULL, false) AS "staffArchived", b."approvalStatus" = 'APPROVED' AS approved FROM "Membership" m JOIN "Business" b ON b.id = m."businessId" LEFT JOIN "Staff" s ON s.id = m."staffId"`)).rows;
    const holds = (row: OldRow, permission: string) => row.status === 'ACTIVE' && row.approved && oldCounted(row) && OLD_GRANTS[row.role]!.includes(permission);
    const expected = OLD_PERMISSIONS.flatMap(permission => old.filter(row => holds(row, permission)).map(row => `${permission} ${row.identityId}@${row.businessId}`)).sort();
    const oldPairs = old.flatMap(actor => old.filter(target => target.businessId === actor.businessId && target.identityId !== actor.identityId).map(target => `${actor.identityId}->${target.identityId}@${actor.businessId} ${oldMayGrant(actor.role, target.role)}`)).sort();

    await t.test('a person with two memberships in one business stops the migration, which changes nothing', async () => {
      await db.query(SLICE_5.map(sql)[0]!);
      await db.query(`INSERT INTO "Membership" (id, "identityId", "businessId", role, status) VALUES ('m-duplicate', 'worker', 'b-live', 'MANAGER', 'REVOKED')`);
      await assert.rejects(db.query(sql(SLICE_5[1]!)), /VISIT_MEMBERSHIP_DUPLICATES/);
      await db.query('ROLLBACK');
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'Membership' AND column_name = 'seeAllCalendars'`)).rows[0].n, 0);
      await db.query(`DELETE FROM "Membership" WHERE id = 'm-duplicate'`);
    });

    await db.query(sql(SLICE_5[1]!));

    await t.test('every permission is held by exactly the people who held it under roles', async () => {
      const actual: string[] = [];
      for (const permission of OLD_PERMISSIONS) {
        const rows = await migrated.membership.findMany({ where: { status: 'ACTIVE', business: { approvalStatus: 'APPROVED' }, AND: [countedMembershipWhere, permissionWhere(permission)] }, select: { identityId: true, businessId: true } });
        actual.push(...rows.map(row => `${permission} ${row.identityId}@${row.businessId}`));
      }
      assert.deepEqual(actual.sort(), expected);
      assert.ok(expected.length > 0);
    });

    await t.test('who may invite or remove whom is unchanged', async () => {
      const rows = await migrated.membership.findMany();
      const pairs = rows.flatMap(actor => rows.filter(target => target.businessId === actor.businessId && target.identityId !== actor.identityId).map(target => `${actor.identityId}->${target.identityId}@${actor.businessId} ${target.role !== 'OWNER' && mayGrant(actor as MemberGrants, target)}`)).sort();
      assert.deepEqual(pairs, oldPairs);
    });

    await t.test('rows keep their status and calendar; managers have all four switches, workers none, owners all', async () => {
      const rows = await migrated.membership.findMany({ orderBy: { id: 'asc' } });
      assert.equal(rows.length, people.length);
      for (const [identityId, businessId, role, status, staffId] of people) {
        const row = rows.find(item => item.identityId === identityId && item.businessId === businessId)!;
        const on = role !== 'STAFF';
        assert.deepEqual([row.role, row.status, row.staffId, row.seeAllCalendars, row.actOnAllCalendars, row.businessSetup, row.manageTeam], [role === 'OWNER' ? 'OWNER' : 'MEMBER', status, staffId, on, on, on, on], identityId);
      }
      assert.equal((await migrated.businessInvitation.findUniqueOrThrow({ where: { id: 'inv-1' } })).inviterRole, 'MANAGER');
    });

    await t.test('the booking triggers read switches, not roles', async () => {
      const bodies: { proname: string; prosrc: string }[] = (await db.query(`SELECT proname, prosrc FROM pg_proc WHERE proname IN ('visit_booking_contact_guard', 'visit_notify_booking_event')`)).rows;
      assert.equal(bodies.length, 2);
      for (const { proname, prosrc } of bodies) assert.doesNotMatch(prosrc, /'MANAGER'|'STAFF'/, proname);
    });
  } finally {
    await migrated.$disconnect();
    await db.end();
    await prisma.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  }
});
