import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import type { Browser, BrowserContext } from 'playwright';
import type { prisma as Prisma } from '../../api/src/db/client.js';
type Options = { browser: Browser; webUrl: string; apiUrl: string; prisma: typeof Prisma; run: string; identityIds: string[]; businessIds: string[] };
export async function homeNavigationSmoke({ browser, webUrl, apiUrl, prisma, run, identityIds, businessIds }: Options) {
  const contexts: BrowserContext[] = [];
  const targetId = businessIds[0]!, otherId = businessIds[1]!;
  async function person(label: string, locale: 'he' | 'en' = 'en') {
    const identity = await prisma.identity.create({ data: { email: `home-${label}-${run}@example.test`, emailVerifiedAt: new Date(), preferredLocale: locale } }); identityIds.push(identity.id);
    const token = randomBytes(32).toString('base64url'); await prisma.session.create({ data: { identityId: identity.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600000) } });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(context);
    await context.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en'));
    await context.addCookies([{ name: 'visit_session', value: token, url: apiUrl, httpOnly: true, sameSite: 'Lax' }]);
    return { identity, context, page: await context.newPage() };
  }
  async function application(identityId: string, status: 'PENDING' | 'REJECTED') {
    const business = await prisma.business.create({ data: { name: `${status} fixture`, slug: `home-${status.toLowerCase()}-${run}-${businessIds.length}`, timezone: 'Asia/Jerusalem' } }); businessIds.push(business.id);
    await prisma.providerApplication.create({ data: { identityId, businessId: business.id, kind: 'NEW_BUSINESS', status } });
    await prisma.membership.create({ data: { identityId, businessId: business.id, role: 'OWNER', status: 'PENDING' } });
  }
  try {
    const customer = await person('customer'), { page, context, identity } = customer;
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    let bootstrap = true;
    await page.route(`${apiUrl}/api/auth/me`, route => bootstrap ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE"}}' }) : route.continue());
    await page.goto(webUrl);
    await page.getByText('Your account could not load. Check your connection and retry.', { exact: true }).waitFor();
    assert.equal(await page.getByText("You haven't added any providers yet", { exact: true }).count(), 0);
    bootstrap = false; await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.getByText("You haven't added any providers yet", { exact: true }).waitFor();
    await page.getByTestId('app-footer').getByRole('button', { name: 'My appointments', exact: true }).waitFor();
    assert.equal(await page.getByText(/Explore services|Find a service|Back to Visit/).count(), 0);
    // A customer has no business, so no mode switch; what the old menu offered lives in Account.
    assert.equal(await page.getByRole('switch').count(), 0);
    const accountButton = page.getByRole('button', { name: 'Account', exact: true });
    await accountButton.click(); await page.waitForURL(`${webUrl}/account`);
    await page.getByRole('link', { name: 'Become a provider', exact: true }).waitFor();
    assert.equal(await page.getByTestId('system-admin').count(), 0);
    await page.getByTestId('app-footer').getByRole('button', { name: 'Home', exact: true }).click(); await page.waitForURL(`${webUrl}/`);
    await page.goto(`${webUrl}/discover`); await page.waitForURL(webUrl + '/');
    await page.goto(`${webUrl}/two`); await page.waitForURL(`${webUrl}/account`);
    await page.goto(webUrl);
    const save = await context.request.post(`${apiUrl}/api/me/providers`, { headers: { Origin: webUrl }, data: { businessId: targetId } }); assert.equal(save.status(), 200);
    const staff = await prisma.staff.findFirstOrThrow({ where: { businessId: targetId } }), service = await prisma.service.findFirstOrThrow({ where: { businessId: targetId } });
    const startsAt = new Date(Date.now() + 7 * 86400000), endsAt = new Date(startsAt.getTime() + 1800000);
    const booking = await prisma.booking.create({ data: { businessId: targetId, customerId: identity.id, staffId: staff.id, serviceId: service.id, status: 'CONFIRMED', startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, idempotencyKey: `home-${run}` } });
    await page.reload(); const card = page.getByTestId(`saved-provider-${targetId}`); await card.waitFor();
    const upcoming = page.getByTestId(`active-booking-${booking.id}`); await upcoming.waitFor();
    assert.equal(await upcoming.isEnabled(), true);
    const above = await upcoming.boundingBox(), below = await page.getByRole('heading', { name: 'My Providers', exact: true }).boundingBox(); assert.ok(above && below && above.y < below.y);
    await card.getByRole('button', { name: /Book appointment$/ }).click(); await page.waitForURL(`${webUrl}/booking/${targetId}`);
    await page.goto(webUrl);
    // Declining the confirmation keeps the provider; confirming archives it, and the archive brings it back.
    await card.getByRole('button', { name: /^Remove .* from my list$/ }).click();
    const removal = page.getByTestId('remove-provider-dialog'); await removal.getByRole('button', { name: 'Keep in my list', exact: true }).click(); await removal.waitFor({ state: 'hidden' });
    assert.equal(await prisma.savedProvider.count({ where: { identityId: identity.id, archivedAt: null } }), 1);
    await card.getByRole('button', { name: /^Remove .* from my list$/ }).click(); await removal.getByRole('button', { name: 'Move to archive', exact: true }).click();
    await page.getByText("You haven't added any providers yet", { exact: true }).waitFor();
    assert.equal(await prisma.savedProvider.count({ where: { identityId: identity.id, archivedAt: null } }), 0);
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status, 'CONFIRMED');
    await page.getByRole('button', { name: 'Provider archive', exact: true }).click(); await page.waitForURL(`${webUrl}/archived-providers`);
    await page.getByTestId(`archived-provider-${targetId}`).getByRole('button', { name: 'Back to my list', exact: true }).click();
    await page.getByText('There are no providers in your archive.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back to Home', exact: true }).click(); await card.waitFor();
    assert.equal(await page.getByRole('button', { name: 'Provider archive', exact: true }).filter({ visible: true }).count(), 0);
    await card.getByRole('button', { name: /^Remove .* from my list$/ }).click(); await removal.getByRole('button', { name: 'Move to archive', exact: true }).click();
    await page.getByText("You haven't added any providers yet", { exact: true }).waitFor();
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status, 'CONFIRMED');
    const unavailable = await prisma.business.create({ data: { name: 'Saved public business', slug: `unavailable-home-${run}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } }); businessIds.push(unavailable.id);
    assert.equal((await context.request.post(`${apiUrl}/api/me/providers`, { headers: { Origin: webUrl }, data: { businessId: unavailable.id } })).status(), 200);
    await prisma.business.update({ where: { id: unavailable.id }, data: { publishedAt: null, name: 'Private draft name' } });
    await page.reload(); const offlineCard = page.getByTestId(`saved-provider-${unavailable.id}`); await offlineCard.waitFor();
    await offlineCard.getByText('Saved public business', { exact: true }).waitFor(); assert.equal(await page.getByText('Private draft name', { exact: true }).count(), 0);
    assert.equal(await offlineCard.getByRole('button', { name: /^Saved public business.*Not accepting bookings$/ }).isDisabled(), true);
    await offlineCard.getByRole('button', { name: 'Remove Saved public business from my list', exact: true }).click(); await page.getByTestId('remove-provider-dialog').getByRole('button', { name: 'Move to archive', exact: true }).click(); await page.getByText("You haven't added any providers yet", { exact: true }).waitFor();
    let failList = true;
    await page.route(`${apiUrl}/api/me/providers`, route => route.request().method() === 'GET' && failList ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE"}}' }) : route.continue());
    await page.reload(); await page.getByRole('alert').filter({ hasText: 'Your providers could not load' }).waitFor();
    assert.equal(await page.getByText("You haven't added any providers yet", { exact: true }).count(), 0);
    failList = false; await page.getByRole('button', { name: 'Reload my providers', exact: true }).click(); await page.getByText("You haven't added any providers yet", { exact: true }).waitFor();
    await accountButton.click(); await page.waitForURL(`${webUrl}/account`);
    await page.route(`${apiUrl}/v1/auth/logout`, route => route.abort());
    const signOut = page.getByRole('button', { name: 'Sign out', exact: true }).filter({ visible: true });
    await signOut.click();
    await page.getByRole('alert').filter({ visible: true }).waitFor(); assert.equal((await context.request.get(`${apiUrl}/api/auth/me`)).status(), 200);
    await page.unroute(`${apiUrl}/v1/auth/logout`);
    await signOut.click(); await page.waitForURL(`${webUrl}/auth/login`);
    // Signed out, Home itself is the login screen: no title-and-button guest page.
    await page.goto(webUrl); await page.waitForURL(`${webUrl}/auth/login`); assert.equal(await page.getByRole('heading', { name: 'Your time, well spent.', exact: true }).count(), 0);

    for (const status of ['PENDING', 'REJECTED'] as const) {
      const applicant = await person(status); await application(applicant.identity.id, status); await applicant.page.goto(`${webUrl}/account`);
      await applicant.page.getByRole('link', { name: 'Application status', exact: true }).waitFor();
      assert.equal(await applicant.page.getByRole('link', { name: 'Become a provider', exact: true }).count(), 0);
      assert.equal(await applicant.page.getByRole('switch').count(), 0);
      await applicant.context.close();
    }
    const manager = await person('manager');
    await prisma.membership.createMany({ data: [targetId, otherId].map(businessId => ({ identityId: manager.identity.id, businessId, role: 'MANAGER' as const, status: 'ACTIVE' as const })) });
    await application(manager.identity.id, 'PENDING');
    await manager.page.goto(`${webUrl}/account`); await manager.page.getByRole('link', { name: 'Application status', exact: true }).waitFor();
    await manager.page.goto(webUrl); await manager.page.getByRole('switch', { name: 'Business management mode', exact: true }).click();
    // Two businesses: the workspace asks which one.
    const other = await prisma.business.findUniqueOrThrow({ where: { id: otherId } });
    await manager.page.getByRole('button', { name: other.name, exact: true }).filter({ visible: true }).click();
    await manager.page.waitForURL(url => url.pathname === '/provider/dashboard' && url.searchParams.get('businessId') === otherId);
    await manager.page.getByRole('heading', { name: other.name, exact: true }).waitFor();
    // Business settings are in Account and team access in the provider footer; Home is the agenda (decisions.md, 2026-11-08).
    await manager.page.getByRole('button', { name: 'Account', exact: true }).click(); await manager.page.getByRole('button', { name: 'Business settings', exact: true }).filter({ visible: true }).click();
    await manager.page.waitForURL(url => url.pathname === `/provider/${otherId}`); await manager.page.getByRole('heading', { name: 'Business settings', exact: true }).filter({ visible: true }).waitFor();
    await manager.page.getByTestId('app-footer').getByRole('button', { name: 'Team access', exact: true }).click();
    await manager.page.waitForURL(url => url.pathname === `/provider/team/${otherId}`); await manager.page.getByRole('heading', { name: 'Team access', exact: true }).filter({ visible: true }).waitFor();
    await manager.page.getByTestId('app-footer').getByRole('button', { name: 'Home', exact: true }).click();
    await manager.page.waitForURL(url => url.pathname === '/provider/dashboard' && url.searchParams.get('businessId') === otherId); await manager.page.getByRole('heading', { name: other.name, exact: true }).filter({ visible: true }).waitFor();
    await manager.page.getByTestId('provider-mode-strip').filter({ visible: true }).waitFor();
    await manager.page.getByRole('switch', { name: 'Business management mode', exact: true }).click(); await manager.page.waitForURL(webUrl + '/');
    const hebrew = await person('hebrew', 'he'); await hebrew.page.goto(webUrl);
    await hebrew.page.getByRole('heading', { name: 'הזמן שלכם, מנוצל היטב.', exact: true }).waitFor();
    await hebrew.page.screenshot({ path: 'test-results/home-header-he-mobile.png', fullPage: true });
    const avatar = await hebrew.page.getByRole('button', { name: 'חשבון', exact: true }).boundingBox(); assert.ok(avatar && avatar.x > 300, JSON.stringify(avatar));
    await hebrew.page.setViewportSize({ width: 1280, height: 900 });
    await hebrew.page.screenshot({ path: 'test-results/home-empty-he-desktop.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: Home bootstrap/empty/saved/offline states, scoped removal, legacy redirects, signed-out Home opens login, no tabs/directory, customer/application/multi-business menu, explicit mode choice, focus trap/return and Hebrew RTL.');
  } finally { await Promise.all(contexts.map(c => c.close())); }
}
