import assert from 'node:assert/strict';
import { randomBytes, randomInt, createHash } from 'node:crypto';
import type { Browser, BrowserContext } from 'playwright';
import type { prisma as Prisma } from '../../api/src/db/client.js';
export async function sharedProvidersSmoke({ browser, webUrl, apiUrl, prisma, run, identityIds, businessId }: { browser: Browser; webUrl: string; apiUrl: string; prisma: typeof Prisma; run: string; identityIds: string[]; businessId: string }) {
  const contexts: BrowserContext[] = [], errors: string[] = [];
  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
  const path = `/p/${business.slug}`;
  async function context() { const c = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(c); await c.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en')); return c; }
  async function session(c: BrowserContext, label: string) {
    const person = await prisma.identity.create({ data: { email: `shared-${label}-${run}@example.test`, emailVerifiedAt: new Date() } }); identityIds.push(person.id);
    const token = randomBytes(32).toString('base64url'); await prisma.session.create({ data: { identityId: person.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600000) } });
    await c.addCookies([{ name: 'visit_session', value: token, url: apiUrl, httpOnly: true, sameSite: 'Lax' }]); return { person, token };
  }
  try {
    const anonymous = await context(), page = await anonymous.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${webUrl}${path}`);
    await page.getByRole('link', { name: 'Sign in and continue to booking', exact: true }).waitFor();
    assert.equal(await prisma.savedProvider.count({ where: { businessId } }), 0);
    assert.equal((await anonymous.request.get(`${apiUrl}/api/provider-links/${business.slug}`, { headers: { Purpose: 'prefetch' } })).status(), 200);
    assert.equal(await prisma.savedProvider.count({ where: { businessId } }), 0);
    await page.getByRole('link', { name: 'Sign in and continue to booking', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/auth/login'); assert.equal(new URL(page.url()).searchParams.get('returnTo'), path);
    const phone = `+1555${randomInt(1000000, 9999999)}`;
    await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill(phone);
    await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
    await page.getByRole('textbox', { name: 'Six-digit verification code', exact: true }).waitFor();
    const otp = await (await fetch(`${apiUrl}/__dev/otp?phone=${encodeURIComponent(phone)}`)).json();
    let saves = 0; page.on('request', r => { if (r.url() === `${apiUrl}/api/me/providers` && r.method() === 'POST') saves++; });
    await page.getByRole('textbox', { name: 'Six-digit verification code', exact: true }).fill(otp.code);
    await page.getByRole('button', { name: 'Verify & continue', exact: true }).click();
    await page.waitForURL(`${webUrl}/booking/${businessId}`);
    const me = await (await anonymous.request.get(`${apiUrl}/api/auth/me`)).json(); identityIds.push(me.profile.id);
    assert.equal(await prisma.savedProvider.count({ where: { identityId: me.profile.id, businessId } }), 1);

    const emailContext = await context(), emailPage = await emailContext.newPage();
    const email = `shared-email-${run}@example.test`;
    await emailPage.goto(`${webUrl}/auth/email?returnTo=${encodeURIComponent(path)}`);
    await emailPage.getByRole('textbox', { name: 'Email address', exact: true }).fill(email);
    const sent = emailPage.waitForResponse(r => r.url() === `${apiUrl}/v1/auth/email-challenges` && r.request().method() === 'POST');
    await emailPage.getByRole('button', { name: 'Email me a sign-in link', exact: true }).click(); assert.equal((await sent).status(), 202);
    const mailbox = await (await emailContext.request.get(`${apiUrl}/__dev/mailbox?email=${encodeURIComponent(email)}`)).json();
    assert.equal(new URL(mailbox.link).searchParams.get('returnTo'), path);
    const callback = await emailContext.newPage(); await callback.goto(mailbox.link);
    await callback.getByRole('button', { name: 'Verify sign-in', exact: true }).click(); await callback.waitForURL(`${webUrl}/booking/${businessId}`);
    const emailMe = await (await emailContext.request.get(`${apiUrl}/api/auth/me`)).json(); identityIds.push(emailMe.profile.id);
    assert.equal(await prisma.savedProvider.count({ where: { identityId: emailMe.profile.id, businessId } }), 1);
    assert.equal(await prisma.membership.count({ where: { identityId: me.profile.id } }), 0);
    await page.getByRole('heading', { name: 'Available appointments', exact: true }).waitFor();
    assert.equal(saves, 1); // Link activation is reused by the booking route.
    await page.goto(`${webUrl}${path}`); await page.waitForURL(`${webUrl}/booking/${businessId}`);
    assert.equal(await prisma.savedProvider.count({ where: { identityId: me.profile.id, businessId } }), 1);

    const retryContext = await context(), b = await session(retryContext, 'retry'), retry = await retryContext.newPage(); retry.on('pageerror', e => errors.push(e.message));
    let failResolve = true, failSave = true;
    await retry.route(`${apiUrl}/api/provider-links/${business.slug}`, route => failResolve ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE"}}' }) : route.continue());
    await retry.goto(`${webUrl}${path}`);
    await retry.getByText('Could not load the provider link. Check your connection and retry.', { exact: true }).waitFor();
    assert.equal(await prisma.savedProvider.count({ where: { identityId: b.person.id } }), 0);
    failResolve = false;
    await retry.route(`${apiUrl}/api/me/providers`, route => route.request().method() === 'POST' && failSave ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE"}}' }) : route.continue());
    await retry.getByRole('button', { name: 'Try again', exact: true }).click();
    await retry.getByText('Could not add this provider. Check your connection and retry.', { exact: true }).waitFor();
    failSave = false; await retry.getByRole('button', { name: 'Try again', exact: true }).click(); await retry.waitForURL(`${webUrl}/booking/${businessId}`);
    const freshDevice = await context(); await freshDevice.addCookies(await retryContext.cookies());
    const list = await (await freshDevice.request.get(`${apiUrl}/api/me/providers`)).json(); assert.equal(list.providers[0].businessId, businessId);
    assert.equal((await freshDevice.request.delete(`${apiUrl}/api/me/providers/${businessId}`, { headers: { Origin: webUrl } })).status(), 200);
    assert.equal(await prisma.savedProvider.count({ where: { identityId: b.person.id } }), 0);

    // Hold an activation under A, then make its server request authenticate as B.
    // Compare-only expected-identity protection must reject, without switching lists.
    const changing = await context(); await changing.addCookies(await anonymous.cookies()); const change = await changing.newPage(); change.on('pageerror', e => errors.push(e.message));
    let arrived!: () => void, release!: () => void; const reached = new Promise<void>(r => { arrived = r; }), wait = new Promise<void>(r => { release = r; });
    const temporary = await context(), other = await session(temporary, 'changed');
    await change.route(`${apiUrl}/api/me/providers`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      assert.equal(route.request().headers()['x-visit-expected-identity'], me.profile.id);
      arrived(); await wait;
      const response = await route.fetch({ headers: { ...route.request().headers(), cookie: `visit_session=${other.token}` } }); assert.equal(response.status(), 409); await route.fulfill({ response });
    });
    await change.goto(`${webUrl}${path}`); await reached; release();
    await change.getByText('Your account changed. Reopen the provider link to continue.', { exact: true }).waitFor();
    assert.equal(await prisma.savedProvider.count({ where: { identityId: other.person.id } }), 0);
    assert.equal(new URL(change.url()).pathname, path);
    await change.screenshot({ path: 'test-results/provider-link-account-changed.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: anonymous shared link -> phone login -> one identity-owned save -> booking; repeat scans, safe previews, offline/retry, cross-device list/remove and account-change rejection.');
  } finally { await Promise.all(contexts.map(c => c.close())); }
}
