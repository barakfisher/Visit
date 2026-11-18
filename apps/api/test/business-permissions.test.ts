import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { BusinessPermission, ROLE_PRIORITY, roleHas, rolesWith } from '../src/security/business-permissions.js';
import { createTwoTenantFixture } from './support/two-tenant.js';

const PERMISSIONS = Object.values(BusinessPermission);

// Slice 1 changes no behaviour: Owner and Manager hold every permission, Staff none (worker-access.md).
test('today every permission belongs to Owner and Manager and none to Staff', () => {
  for (const permission of PERMISSIONS) {
    assert.equal(roleHas('OWNER', permission), true, permission);
    assert.equal(roleHas('MANAGER', permission), true, permission);
    assert.equal(roleHas('STAFF', permission), false, permission);
    assert.deepEqual(rolesWith(permission), ['OWNER', 'MANAGER'], permission);
  }
  assert.deepEqual(ROLE_PRIORITY, ['OWNER', 'MANAGER', 'STAFF']);
});

test('each permission guards its routes for members of this business only', async t => {
  const app = await createApp();
  const fixture = await createTwoTenantFixture();
  const north = fixture.businesses[0]!.id;
  // One read per permission; WORKSPACE is checked through the profile below.
  const routes: Record<Exclude<BusinessPermission, 'WORKSPACE'>, string[]> = {
    SEE_ALL_CALENDARS: [`/api/provider/agenda?businessId=${north}&date=${fixture.date}`, `/api/provider/block-time?businessId=${north}`, `/v1/provider/businesses/${north}/bookings`],
    ACT_ON_ALL_CALENDARS: [`/v1/provider/businesses/${north}/manual-booking-options`],
    SEARCH_CUSTOMERS: [`/v1/provider/businesses/${north}/customer-cards?q=qa`],
    BUSINESS_SETUP: [`/v1/provider/businesses/${north}/booking-policy`, `/v1/provider/businesses/${north}/staff`, `/v1/provider/businesses/${north}/availability-rules`, `/v1/provider/businesses/${north}/publication`],
    MANAGE_TEAM: [`/v1/provider/businesses/${north}/team`],
  };
  try {
    for (const [permission, urls] of Object.entries(routes)) await t.test(permission, async () => {
      for (const url of urls) {
        for (const actor of ['north', 'dual'] as const) {
          const response = await app.inject({ url, headers: fixture.headers(actor) });
          assert.ok(response.statusCode < 400, `${actor} ${url}: ${response.statusCode} ${response.body}`);
        }
        // Staff of this business, a pending owner, an outsider and the other business's owner.
        for (const actor of ['staff', 'pending', 'outsider', 'south'] as const) {
          const response = await app.inject({ url, headers: fixture.headers(actor) });
          assert.ok([403, 404].includes(response.statusCode), `${actor} ${url}: ${response.statusCode}`);
        }
      }
    });
    await t.test('WORKSPACE', async () => {
      const businesses = async (actor: 'north' | 'dual' | 'staff') => (await app.inject({ url: '/api/auth/me', headers: fixture.headers(actor) })).json().profile.businesses.map((b: { id: string }) => b.id).sort();
      assert.deepEqual(await businesses('north'), [north]);
      assert.deepEqual(await businesses('dual'), fixture.businesses.map(b => b.id).sort());
      assert.deepEqual(await businesses('staff'), []);
    });
  } finally {
    await fixture.reset();
    await app.close();
  }
});
