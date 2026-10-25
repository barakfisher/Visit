import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { prisma as Prisma } from '../../api/src/db/client.js';

type Options = { browser: Browser; webUrl: string; apiUrl: string; claims: Map<string, Record<string, unknown>>; run: string; prisma: typeof Prisma; identityIds: string[] };
export async function googleSmoke({ browser, webUrl, apiUrl, claims, run, prisma, identityIds }: Options) {
  const contexts: BrowserContext[] = [], errors: string[] = [];
  const subject = `browser-${run}`, email = `google-${run}@example.test`;
  async function context() {
    const value = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(value);
    await value.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en'));
    return value;
  }
  async function intercept(page: Page, options: { email?: string; sub?: string; cancel?: boolean; fail?: boolean } = {}) {
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://accounts.google.com/**', async route => {
      const authorization = new URL(route.request().url());
      assert.equal(authorization.searchParams.get('response_type'), 'code');
      assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
      const code = randomUUID(), state = authorization.searchParams.get('state')!;
      claims.set(code, { iss: 'https://accounts.google.com', aud: options.fail ? 'wrong-audience' : 'web-test-client', sub: options.sub ?? subject, email: options.email ?? email, email_verified: true, nonce: authorization.searchParams.get('nonce'), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
      const callback = new URL(`${apiUrl}/api/auth/google/callback`);
      callback.searchParams.set('state', state); callback.searchParams.set(options.cancel ? 'error' : 'code', options.cancel ? 'access_denied' : code);
      await route.fulfill({ status: 302, headers: { location: callback.href }, body: '' });
    });
  }
  async function begin(page: Page) {
    await page.goto(`${webUrl}/auth/login`);
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await page.getByRole('heading', { name: 'Confirm Google sign-in' }).waitFor();
    await page.waitForURL(url => url.pathname === '/auth/google' && !url.hash && !url.search, { waitUntil: 'domcontentloaded' }).catch(async error => { console.error('Callback URL shape:', new URL(page.url()).pathname, new URL(page.url()).hash ? 'fragment-present' : 'fragment-empty', new URL(page.url()).search ? 'query-present' : 'query-empty'); await page.screenshot({ path: 'test-results/google-callback-failure.png' }); throw error; });
    assert.equal(new URL(page.url()).hash, '');
    assert.equal(await page.locator('script[src*="accounts.google.com"]').count(), 0);
  }
  try {
    const consumer = await context(), page = await consumer.newPage(); await intercept(page);
    await begin(page);
    await page.getByText(email, { exact: true }).waitFor();
    assert.equal((await consumer.request.get(`${apiUrl}/api/auth/me`)).status(), 401); // Preview has no session.
    let redemptions = 0, blockProfile = true;
    page.on('request', request => { if (request.url() === `${apiUrl}/api/auth/google`) redemptions++; });
    await page.route(`${apiUrl}/api/auth/me`, async route => { if (blockProfile) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }) }); else await route.continue(); });
    await page.getByRole('button', { name: 'Confirm & continue', exact: true }).click();
    await page.getByRole('button', { name: 'Continue to my account', exact: true }).waitFor();
    const identity = await prisma.identity.findUniqueOrThrow({ where: { email } }); identityIds.push(identity.id);
    assert.equal(await prisma.externalIdentity.count({ where: { identityId: identity.id, provider: 'google' } }), 1);
    blockProfile = false;
    // A profile of a different identity must never get activated during recovery.
    let mismatch = true;
    await page.unroute(`${apiUrl}/api/auth/me`);
    await page.route(`${apiUrl}/api/auth/me`, async route => { if (mismatch) await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile: { id: 'foreign', email: 'foreign@example.test', phone: null, is_provider: false, businesses: [] } }) }); else await route.continue(); });
    await page.getByRole('button', { name: 'Continue to my account', exact: true }).click();
    await page.getByRole('alert').waitFor(); assert.equal(new URL(page.url()).pathname, '/auth/google');
    mismatch = false;
    await page.getByRole('button', { name: 'Continue to my account', exact: true }).click();
    await page.waitForURL('**/discover'); assert.equal(redemptions, 1);
    assert.equal(await page.evaluate(() => localStorage.getItem('visit.session-token')), null);
    const me = await (await consumer.request.get(`${apiUrl}/api/auth/me`)).json(); assert.equal(me.profile.id, identity.id);
    console.log('PASS: Google code/PKCE browser login, scrubbed handoff, explicit preview, profile outage/mismatch recovery without replay.');

    // Account settings use a distinct code proof and preserve its issued replacement on profile failure.
    await page.unroute(`${apiUrl}/api/auth/me`);
    await page.goto(`${webUrl}/two`);
    await page.getByRole('heading', { name: 'Sign-in methods', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Request reviewed recovery (not available yet)', exact: true }).isDisabled().then(value => assert.equal(value, true));
    const oldDevice = await context(); await oldDevice.addCookies(await consumer.cookies());
    const newEmail = `changed-google-${run}@example.test`;
    await page.getByLabel('New email address', { exact: true }).fill(newEmail);
    const started = page.waitForResponse(response => response.url() === `${apiUrl}/api/account/contact-challenges`);
    await page.getByRole('button', { name: 'Send code to verify this contact', exact: true }).click();
    const challenge = await (await started).json();
    const codeResponse = await consumer.request.post(`${apiUrl}/__dev/account/contact-code`, { headers: { Origin: webUrl }, data: { challenge: challenge.challenge } }); assert.equal(codeResponse.status(), 200);
    await page.getByLabel('Six-digit verification code').fill((await codeResponse.json()).code);
    let recovering = true, contactRedemptions = 0;
    page.on('request', request => { if (request.url() === `${apiUrl}/api/account/contact-challenges/verify`) contactRedemptions++; });
    await page.route(`${apiUrl}/api/auth/me`, async route => { if (recovering) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }) }); else await route.continue(); });
    await page.getByRole('button', { name: 'Verify & save contact', exact: true }).click();
    await page.getByRole('button', { name: 'Finish updating my account', exact: true }).waitFor();
    recovering = false;
    await page.getByRole('button', { name: 'Finish updating my account', exact: true }).click();
    await page.getByText('Sign-in settings updated. Other devices were signed out.', { exact: true }).waitFor();
    assert.equal(contactRedemptions, 1);
    assert.equal((await prisma.identity.findUniqueOrThrow({ where: { id: identity.id } })).email, newEmail);
    assert.equal((await oldDevice.request.get(`${apiUrl}/api/auth/me`)).status(), 401);
    const emailCard = page.getByText(newEmail, { exact: true }).locator('..');
    await emailCard.getByRole('button', { name: 'Remove method', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
    await page.getByText('Add another verified method before removing', { exact: true }).waitFor();
    assert.equal((await prisma.identity.findUniqueOrThrow({ where: { id: identity.id } })).email, null);
    assert.equal(await prisma.googleAuthProof.count({ where: { identityId: identity.id } }), 1);
    await page.getByRole('button', { name: 'עברית', exact: true }).click();
    await page.getByRole('heading', { name: 'אמצעי כניסה', exact: true }).waitFor();
    assert.equal(await page.getByLabel('כתובת דואר חדשה', { exact: true }).evaluate(element => getComputedStyle(element).direction), 'ltr');
    console.log('PASS: linked-method settings, verified contact replacement/profile recovery, other-device revocation, explicit removal/last-method protection and Hebrew RTL.');

    const existing = await prisma.identity.create({ data: { email: `existing-google-${run}@example.test` } }); identityIds.push(existing.id);
    const conflict = await context(), conflictPage = await conflict.newPage();
    await intercept(conflictPage, { email: existing.email!, sub: `existing-${run}` }); await begin(conflictPage);
    await conflictPage.getByRole('button', { name: 'Confirm & continue', exact: true }).click();
    await conflictPage.getByText(/An account already uses this email/).waitFor();
    assert.equal(await prisma.externalIdentity.count({ where: { identityId: existing.id } }), 0);
    assert.equal((await conflict.request.get(`${apiUrl}/api/auth/me`)).status(), 401);

    // Authenticate by the existing email method, then explicitly initiate and confirm linking.
    await conflict.request.post(`${apiUrl}/v1/auth/email-challenges`, { headers: { Origin: webUrl }, data: { email: existing.email, target: 'web' } });
    const local = await (await conflict.request.get(`${apiUrl}/__dev/mailbox?email=${encodeURIComponent(existing.email!)}`)).json();
    const verified = await conflict.request.post(`${apiUrl}/v1/auth/email-challenges/verify`, { headers: { Origin: webUrl }, data: { token: local.token } }); assert.equal(verified.status(), 200);
    await conflictPage.goto(`${webUrl}/two`);
    await conflictPage.getByRole('heading', { name: 'Sign-in methods', exact: true }).waitFor();
    await conflictPage.getByRole('button', { name: 'Link a Google account', exact: true }).click();
    await conflictPage.getByRole('heading', { name: 'Confirm Google sign-in', exact: true }).waitFor();
    await conflictPage.getByRole('button', { name: 'Link this Google account', exact: true }).waitFor();
    assert.equal(await prisma.externalIdentity.count({ where: { identityId: existing.id } }), 0);
    await conflictPage.getByRole('button', { name: 'Link this Google account', exact: true }).click();
    await conflictPage.waitForURL('**/two');
    assert.equal(await prisma.externalIdentity.count({ where: { identityId: existing.id, provider: 'google' } }), 1);
    assert.equal((await (await conflict.request.get(`${apiUrl}/api/auth/me`)).json()).profile.id, existing.id);
    console.log('PASS: Google email conflict does not merge; existing-method authentication and explicit linking preserve identity.');

    for (const scenario of [{ cancel: true }, { fail: true }]) {
      const isolated = await context(), isolatedPage = await isolated.newPage();
      await intercept(isolatedPage, scenario); await begin(isolatedPage);
      await isolatedPage.getByText(scenario.cancel ? /Google sign-in was cancelled/ : /Google sign-in could not be completed/).waitFor();
      assert.equal((await isolated.request.get(`${apiUrl}/api/auth/me`)).status(), 401);
    }
    const invalid = await context(), invalidPage = await invalid.newPage();
    await invalidPage.goto(`${webUrl}/auth/google#grant=malformed`);
    await invalidPage.getByText(/Google sign-in could not be completed/).waitFor();
    await invalidPage.waitForURL(`${webUrl}/auth/google`);
    assert.deepEqual(errors, []);
    console.log('PASS: Google cancellation, invalid claims and malformed callback fail safely without sessions. No Google network requests.');
  } finally { await Promise.all(contexts.map(value => value.close())); }
}
