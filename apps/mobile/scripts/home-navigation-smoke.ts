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
    assert.equal(await page.getByRole('tablist').count(), 0);
    assert.equal(await page.getByText(/Explore services|Find a service|Back to Visit/).count(), 0);
    const menuButton = page.getByRole('button', { name: 'Open menu', exact: true });
    await menuButton.click(); const dialog = page.getByRole('dialog', { name: 'Menu', exact: true }); await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Become a provider', exact: true }).waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Switch to provider mode', exact: true }).count(), 0);
    for (let i = 0; i < 10; i++) { await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true); }
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal(await menuButton.evaluate(el => el === document.activeElement), true);
    await page.goto(`${webUrl}/discover`); await page.waitForURL(webUrl + '/');
    await page.goto(`${webUrl}/two`); await page.waitForURL(`${webUrl}/account`);
    await page.goto(webUrl);
    const save = await context.request.post(`${apiUrl}/api/me/providers`, { headers: { Origin: webUrl }, data: { businessId: targetId } }); assert.equal(save.status(), 200);
    const staff = await prisma.staff.findFirstOrThrow({ where: { businessId: targetId } }), service = await prisma.service.findFirstOrThrow({ where: { businessId: targetId } });
    const startsAt = new Date(Date.now() + 7 * 86400000), endsAt = new Date(startsAt.getTime() + 1800000);
    const booking = await prisma.booking.create({ data: { businessId: targetId, customerId: identity.id, staffId: staff.id, serviceId: service.id, status: 'CONFIRMED', startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, idempotencyKey: `home-${run}` } });
    await page.reload(); const card = page.getByTestId(`saved-provider-${targetId}`); await card.waitFor();
    const upcoming = page.getByTestId(`active-booking-${booking.id}`); await upcoming.waitFor();
    assert.equal(await upcoming.getByRole('button', { name: 'Reschedule appointment', exact: true }).isEnabled(), true);
    const above = await upcoming.boundingBox(), below = await page.getByRole('heading', { name: 'My Providers', exact: true }).boundingBox(); assert.ok(above && below && above.y < below.y);
    await card.getByRole('button', { name: 'Book appointment', exact: true }).click(); await page.waitForURL(`${webUrl}/booking/${targetId}`);
    await page.goto(webUrl); await card.getByRole('button', { name: 'Remove from my list', exact: true }).click();
    await page.getByText("You haven't added any providers yet", { exact: true }).waitFor();
    assert.equal(await prisma.savedProvider.count({ where: { identityId: identity.id } }), 0);
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).status, 'CONFIRMED');
    const unavailable = await prisma.business.create({ data: { name: 'Saved public business', slug: `unavailable-home-${run}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } }); businessIds.push(unavailable.id);
    assert.equal((await context.request.post(`${apiUrl}/api/me/providers`, { headers: { Origin: webUrl }, data: { businessId: unavailable.id } })).status(), 200);
    await prisma.business.update({ where: { id: unavailable.id }, data: { publishedAt: null, name: 'Private draft name' } });
    await page.reload(); const offlineCard = page.getByTestId(`saved-provider-${unavailable.id}`); await offlineCard.waitFor();
    await offlineCard.getByText('Saved public business', { exact: true }).waitFor(); assert.equal(await page.getByText('Private draft name', { exact: true }).count(), 0);
    assert.equal(await offlineCard.getByRole('button', { name: 'Not accepting bookings', exact: true }).isDisabled(), true);
    await offlineCard.getByRole('button', { name: 'Remove from my list', exact: true }).click(); await page.getByText("You haven't added any providers yet", { exact: true }).waitFor();
    let failList = true;
    await page.route(`${apiUrl}/api/me/providers`, route => route.request().method() === 'GET' && failList ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE"}}' }) : route.continue());
    await page.reload(); await page.getByRole('alert').filter({ hasText: 'Your providers could not load' }).waitFor();
    assert.equal(await page.getByText("You haven't added any providers yet", { exact: true }).count(), 0);
    failList = false; await page.getByRole('button', { name: 'Reload my providers', exact: true }).click(); await page.getByText("You haven't added any providers yet", { exact: true }).waitFor();
    await menuButton.click();
    await page.route(`${apiUrl}/v1/auth/logout`, route => route.abort());
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('dialog').getByRole('alert').waitFor(); assert.equal((await context.request.get(`${apiUrl}/api/auth/me`)).status(), 200);
    await page.unroute(`${apiUrl}/v1/auth/logout`);
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click(); await page.waitForURL(`${webUrl}/auth/login`);

    for (const status of ['PENDING', 'REJECTED'] as const) {
      const applicant = await person(status); await application(applicant.identity.id, status); await applicant.page.goto(webUrl);
      await applicant.page.getByRole('button', { name: 'Open menu', exact: true }).click(); const drawer = applicant.page.getByRole('dialog', { name: 'Menu', exact: true });
      await drawer.getByRole('button', { name: 'Application status', exact: true }).waitFor();
      assert.equal(await drawer.getByRole('button', { name: 'Become a provider', exact: true }).count(), 0);
      assert.equal(await drawer.getByRole('button', { name: 'Switch to provider mode', exact: true }).count(), 0);
      await applicant.context.close();
    }
    const manager = await person('manager');
    await prisma.membership.createMany({ data: [targetId, otherId].map(businessId => ({ identityId: manager.identity.id, businessId, role: 'MANAGER' as const, status: 'ACTIVE' as const })) });
    await application(manager.identity.id, 'PENDING');
    await manager.page.goto(webUrl); await manager.page.getByRole('button', { name: 'Open menu', exact: true }).click();
    const drawer = manager.page.getByRole('dialog', { name: 'Menu', exact: true });
    await drawer.getByRole('button', { name: 'Application status', exact: true }).waitFor();
    await drawer.getByRole('button', { name: 'Switch to provider mode', exact: true }).click();
    const other = await prisma.business.findUniqueOrThrow({ where: { id: otherId } });
    await drawer.getByRole('button', { name: other.name, exact: true }).click();
    await manager.page.waitForURL(url => url.pathname === '/provider/dashboard' && url.searchParams.get('businessId') === otherId);
    await manager.page.getByRole('heading', { name: other.name, exact: true }).waitFor();
    await manager.page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await manager.page.getByRole('dialog').getByRole('button', { name: 'Switch to customer mode', exact: true }).click(); await manager.page.waitForURL(webUrl + '/');
    const hebrew = await person('hebrew', 'he'); await hebrew.page.goto(webUrl);
    await hebrew.page.getByRole('heading', { name: 'הזמן שלכם, מנוצל היטב.', exact: true }).waitFor();
    await hebrew.page.getByRole('button', { name: 'פתיחת תפריט', exact: true }).click();
    const rtl = hebrew.page.getByRole('dialog', { name: 'תפריט', exact: true }); await rtl.waitFor();
    await hebrew.page.screenshot({ path: 'test-results/home-menu-he-mobile.png', fullPage: true });
    const panel = await rtl.getByTestId('menu-panel').boundingBox(); assert.ok(panel && panel.x > 30 && Math.abs(panel.x + panel.width - 390) < 2, JSON.stringify(panel));
    await hebrew.page.keyboard.press('Escape'); await hebrew.page.setViewportSize({ width: 1280, height: 900 });
    await hebrew.page.screenshot({ path: 'test-results/home-empty-he-desktop.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: Home bootstrap/empty/saved/offline states, scoped removal, legacy redirects, no tabs/directory, customer/application/multi-business menu, explicit mode choice, focus trap/return and Hebrew RTL.');
  } finally { await Promise.all(contexts.map(c => c.close())); }
}
