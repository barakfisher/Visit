import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID, randomInt } from 'node:crypto';
import type { Browser } from 'playwright';
export async function providerAccessSmoke({ browser, webUrl, apiUrl }: { browser: Browser; webUrl: string; apiUrl: string }) {
  const { prisma } = await import('../../api/src/db/client.js');
  const ids: string[] = [], businesses: string[] = [], contexts = [];
  let releaseHolding = () => {};
  try {
    for (let n = 0; n < 2; n++) {
      const b = await prisma.business.create({ data: { name: `Protected studio ${n}`, slug: `guard-${randomUUID()}`, approvalStatus: 'APPROVED', timezone: 'Asia/Jerusalem' } }); businesses.push(b.id);
    }
    const phone = `+1555${randomInt(1000000, 9999999)}`;
    const id = await prisma.identity.create({ data: { phone, phoneVerifiedAt: new Date(), email: `guard-${randomUUID()}@example.test`, emailVerifiedAt: new Date(), preferredLocale: 'en' } }); ids.push(id.id);
    const saved = await prisma.savedProvider.create({ data: { identityId: id.id, businessId: businesses[0]!, displayName: 'My existing provider' } });
    const token = randomBytes(32).toString('base64url'); await prisma.session.create({ data: { identityId: id.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600000) } });
    await prisma.membership.createMany({ data: businesses.map(businessId => ({ businessId, identityId: id.id, role: 'OWNER' as const, status: 'ACTIVE' as const })) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(context); await context.addCookies([{ name: 'visit_session', value: token, url: webUrl, httpOnly: true, sameSite: 'Lax' }]); await context.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en'));
    const page = await context.newPage(), errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const held = new Promise<void>(resolve => { releaseHolding = resolve; });
    let reached: (() => void) | undefined; const intercepted = new Promise<void>(resolve => { reached = resolve; });
    await page.route(`${apiUrl}/api/auth/me`, async route => { reached!(); await held; await route.continue().catch(error => { if (!page.isClosed()) throw error; }); });
    await page.goto(`${webUrl}/provider/dashboard`);
    await intercepted;
    assert.equal(await page.getByRole('tab', { name: 'Service Catalog' }).count(), 0, 'private screens cannot render while identity hydrates'); releaseHolding(); await page.unrouteAll({ behavior: 'wait' });
    await page.getByRole('heading', { name: 'Choose the business to manage', exact: true }).waitFor(); assert.equal(await page.getByRole('tab', { name: 'Service Catalog' }).count(), 0);
    await page.getByRole('button', { name: 'Protected studio 0', exact: true }).click(); await page.getByRole('heading', { name: 'Protected studio 0', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Block time / add a break', exact: true }).click(); await page.getByLabel('Break reason').fill('Private draft that must be discarded');
    await page.getByRole('button', { name: 'Protected studio 1', exact: true }).click(); await page.getByRole('heading', { name: 'Protected studio 1', exact: true }).waitFor(); assert.equal(await page.getByLabel('Break reason').count(), 0);
    await page.goto(`${webUrl}/provider/dashboard?businessId=foreign-business`); await page.getByRole('alert').filter({ hasText: 'An approved provider account is required' }).waitFor(); assert.equal(await page.getByRole('tab', { name: 'Service Catalog' }).count(), 0);
    await page.goto(`${webUrl}/provider/team/${businesses[0]}`); await page.getByLabel('Verified recipient contact').waitFor();
    await page.getByRole('button', { name: 'Manager', exact: true }).waitFor();
    await prisma.membership.updateMany({ where: { identityId: id.id, businessId: businesses[0] }, data: { role: 'MANAGER' } });
    await page.getByRole('button', { name: 'Manager', exact: true }).waitFor({ state: 'hidden' });
    await page.getByLabel('Verified recipient contact').waitFor();
    assert.equal(await page.getByLabel('Verified recipient contact').count(), 1, 'role downgrade keeps permitted Staff invitations available');
    await page.goto(`${webUrl}/provider/${businesses[0]}`); await page.getByRole('heading', { name: 'Set up your business', exact: true }).waitFor();
    await prisma.membership.updateMany({ where: { businessId: businesses[0], identityId: id.id }, data: { status: 'REVOKED' } });
    await page.getByTestId('setup-section-services').click(); // A real protected API read denies and invalidates the stale workspace.
    await page.getByRole('alert').filter({ hasText: 'An approved provider account is required' }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Set up your business', exact: true }).count(), 0);
    assert.equal((await context.request.get(`${apiUrl}/v1/me`)).status(), 200, 'customer identity remains signed in');
    await page.goto(`${webUrl}/provider/${businesses[1]}`); await page.getByRole('heading', { name: 'Set up your business', exact: true }).waitFor();
    await prisma.session.updateMany({ where: { identityId: id.id }, data: { revokedAt: new Date() } });
    await page.getByTestId('setup-section-services').click(); await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: 'Set up your business', exact: true }).count(), 0);
    await page.getByRole('link', { name: 'Sign in', exact: true }).click(); await page.waitForURL(url => url.pathname === '/auth/login' && url.searchParams.get('returnTo') === `/provider/${businesses[1]}`);
    await page.getByLabel('Phone number', { exact: true }).fill(phone); await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
    await page.getByLabel('Six-digit verification code').waitFor();
    const otp = await (await context.request.get(`${apiUrl}/__dev/otp?phone=${encodeURIComponent(phone)}`)).json();
    await page.getByLabel('Six-digit verification code').fill(otp.code); await page.getByRole('button', { name: 'Verify & continue', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/provider/${businesses[1]}`); await page.getByRole('heading', { name: 'Set up your business', exact: true }).waitFor();
    assert.equal((await context.request.get(`${apiUrl}/api/auth/me`)).status(), 200);
    assert.equal((await prisma.savedProvider.findUniqueOrThrow({ where: { id: saved.id } })).identityId, id.id);
    await page.getByRole('button', { name: 'Open menu', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click(); await page.waitForURL(url => url.pathname === '/auth/login');
    await page.goto(`${webUrl}/provider/${businesses[1]}`); await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
    const guest = await browser.newContext(); contexts.push(guest); await guest.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en')); const guestPage = await guest.newPage(); await guestPage.goto(`${webUrl}/provider/team/${businesses[0]}`); await guestPage.getByRole('link', { name: 'Sign in', exact: true }).waitFor(); assert.equal(await guestPage.getByLabel('Verified recipient contact').count(), 0);
    const newcomer = await prisma.identity.create({ data: { email: `new-provider-${randomUUID()}@example.test`, emailVerifiedAt: new Date(), preferredLocale: 'en' } }); ids.push(newcomer.id);
    const newToken = randomBytes(32).toString('base64url'); await prisma.session.create({ data: { identityId: newcomer.id, tokenHash: createHash('sha256').update(newToken).digest('hex'), expiresAt: new Date(Date.now() + 600000) } });
    const newlyApproved = await browser.newContext(); contexts.push(newlyApproved); await newlyApproved.addCookies([{ name: 'visit_session', value: newToken, url: webUrl, httpOnly: true, sameSite: 'Lax' }]); await newlyApproved.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en'));
    const newPage = await newlyApproved.newPage(); await newPage.goto(webUrl); await newPage.getByRole('heading', { name: 'Your time, well spent.', exact: true }).waitFor();
    // Simulate the committed result of the separately tested administrator review while Home remains open.
    await prisma.membership.create({ data: { identityId: newcomer.id, businessId: businesses[1]!, role: 'OWNER', status: 'ACTIVE' } });
    await newPage.getByRole('button', { name: 'Open menu', exact: true }).click(); await newPage.getByRole('dialog').getByRole('button', { name: 'Switch to provider mode', exact: true }).click();
    await newPage.getByRole('heading', { name: 'Protected studio 1', exact: true }).waitFor();
    await newPage.getByRole('button', { name: 'Open menu', exact: true }).click(); await newPage.getByRole('dialog').getByRole('button', { name: 'Switch to customer mode', exact: true }).click(); await newPage.getByRole('heading', { name: 'Your time, well spent.', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log('PASS: protected hydration, explicit workspace choice, URL authority, discarded drafts, live membership revocation, retained customer identity, session expiry and safe sign-in recovery.');
  } catch (error) { for (const context of contexts) for (const page of context.pages()) console.error((await page.locator('body').innerText()).slice(0, 2000)); throw error;
  } finally { releaseHolding(); await Promise.all(contexts.map(c => c.close())); await prisma.savedProvider.deleteMany({ where: { identityId: { in: ids }, businessId: { in: businesses } } }); await prisma.business.deleteMany({ where: { id: { in: businesses } } }); await prisma.identity.deleteMany({ where: { id: { in: ids } } }); }
}
