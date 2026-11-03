import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { prisma } from '../src/db/client.js';
import { redis } from '../src/infra/redis.js';
import { AppError } from '../src/http/errors.js';
import { saveBusinessPolicy, VERIFIED_PHONE_UNAVAILABLE } from '../src/repositories/provider-settings.js';
import { requireBusinessMembership } from '../src/security/tenant-context.js';
import { DEFAULT_BOOKING_POLICY } from '../src/scheduling/rules.js';
after(async () => { redis.disconnect(); await prisma.$disconnect(); });

const MIGRATION = new URL('../prisma/migrations/20261103150000_verified_phone_unavailable/migration.sql', import.meta.url);
const unavailable = (error: unknown) => error instanceof AppError && error.statusCode === 409 && error.code === VERIFIED_PHONE_UNAVAILABLE;

test('the verified-phone requirement is refused while SMS is off and allowed once it is on', async t => {
  const owner = await prisma.identity.create({ data: { displayName: 'Policy owner' } });
  const staffMember = await prisma.identity.create({ data: { displayName: 'Policy staff' } });
  const business = await prisma.business.create({ data: { name: 'Phone policy fixture', slug: `phone-policy-${randomUUID()}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED' } });
  await prisma.membership.createMany({ data: [{ businessId: business.id, identityId: owner.id, role: 'OWNER', status: 'ACTIVE' }, { businessId: business.id, identityId: staffMember.id, role: 'STAFF', status: 'ACTIVE' }] });
  const stored = async () => prisma.bookingPolicy.findUnique({ where: { businessId: business.id } });
  try {
    const context = await requireBusinessMembership(owner.id, business.id, ['OWNER']);
    await t.test('SMS off: turning it on is refused and nothing is written', async () => {
      await assert.rejects(saveBusinessPolicy(context, { ...DEFAULT_BOOKING_POLICY, requireVerifiedPhone: true }, { phoneVerification: false }), unavailable);
      assert.equal(await stored(), null);
    });
    await t.test('SMS off: the rest of the policy saves with the requirement off', async () => {
      const policy = await saveBusinessPolicy(context, { ...DEFAULT_BOOKING_POLICY, requireVerifiedPhone: false, requireVerifiedEmail: true }, { phoneVerification: false });
      assert.equal(policy.requireVerifiedPhone, false);
      assert.equal(policy.requireVerifiedEmail, true);
    });
    await t.test('SMS on: the requirement saves', async () => {
      assert.equal((await saveBusinessPolicy(context, { ...DEFAULT_BOOKING_POLICY, requireVerifiedPhone: true }, { phoneVerification: true })).requireVerifiedPhone, true);
    });
    await t.test('SMS off: a policy that already requires a phone can be turned off but not saved with it on', async () => {
      await assert.rejects(saveBusinessPolicy(context, { ...DEFAULT_BOOKING_POLICY, requireVerifiedPhone: true, minimumNoticeMinutes: 0 }, { phoneVerification: false }), unavailable);
      assert.equal((await stored())?.minimumNoticeMinutes, DEFAULT_BOOKING_POLICY.minimumNoticeMinutes);
      assert.equal((await saveBusinessPolicy(context, { ...DEFAULT_BOOKING_POLICY, requireVerifiedPhone: false }, { phoneVerification: false })).requireVerifiedPhone, false);
    });
    await t.test('staff cannot reach the policy before the SMS check', async () => {
      await assert.rejects(requireBusinessMembership(staffMember.id, business.id, ['OWNER', 'MANAGER']));
    });
    await t.test('the migration turns the requirement off and leaves the other requirements', async () => {
      const sql = await readFile(MIGRATION, 'utf8');
      await prisma.bookingPolicy.update({ where: { businessId: business.id }, data: { requireVerifiedPhone: true, requireVerifiedEmail: true, requireCustomerName: true } });
      const rollback = new Error('rollback');
      await assert.rejects(prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe(sql);
        const policy = await tx.bookingPolicy.findUniqueOrThrow({ where: { businessId: business.id } });
        assert.equal(policy.requireVerifiedPhone, false);
        assert.equal(policy.requireVerifiedEmail, true);
        assert.equal(policy.requireCustomerName, true);
        throw rollback;
      }), error => error === rollback);
    });
  } finally {
    await prisma.business.deleteMany({ where: { id: business.id } });
    await prisma.identity.deleteMany({ where: { id: { in: [owner.id, staffMember.id] } } });
  }
});
