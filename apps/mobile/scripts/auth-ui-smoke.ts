import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import type { Browser, BrowserContext } from 'playwright';
type Options = { browser: Browser; webUrl: string; apiUrl: string; run: string; identityIds: string[] };
export async function authUiSmoke({ browser, webUrl, apiUrl, run, identityIds }: Options) {
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  const nextContext = async () => { const value = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(value); await value.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en')); return value; };
  try {
    const context = await nextContext(), page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${webUrl}/auth/login`);
    await page.getByRole('link', { name: 'Have a business? Register as a provider' }).click();
    await page.getByRole('heading', { name: 'Register your business with Visit' }).waitFor();
    await page.getByRole('link', { name: 'Sign in to apply' }).click();
    await page.waitForURL(url => url.pathname === '/auth/login');
    assert.equal(new URL(page.url()).searchParams.get('returnTo'), '/register/provider');
    const phone = `+1555${randomInt(1000000, 9999999)}`;
    await page.getByRole('textbox', { name: 'Phone number', exact: true }).fill(phone);
    await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
    await page.getByRole('button', { name: /Send another code in/ }).waitFor();
    const message = await (await fetch(`${apiUrl}/__dev/otp?phone=${encodeURIComponent(phone)}`)).json() as { code: string };
    await page.getByRole('textbox', { name: 'Six-digit verification code', exact: true }).fill(message.code);
    let redemptions = 0, blockProfile = true;
    page.on('request', request => { if (request.url() === `${apiUrl}/api/auth/otp/verify`) redemptions++; });
    await page.route(`${apiUrl}/api/auth/me`, route => blockProfile ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }) }) : route.continue());
    // Same-turn double activation exercises the ref guard before React disables.
    await page.getByRole('button', { name: 'Verify & continue', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await page.getByRole('button', { name: 'Continue to my account', exact: true }).waitFor();
    assert.equal(redemptions, 1);
    const me = await (await context.request.get(`${apiUrl}/api/auth/me`)).json(); identityIds.push(me.profile.id);
    assert.equal(me.profile.is_provider, false);
    assert.equal(await page.getByRole('textbox', { name: 'Six-digit verification code', exact: true }).count(), 0);
    blockProfile = false;
    await page.getByRole('button', { name: 'Continue to my account', exact: true }).click();
    await page.waitForURL(`${webUrl}/register/provider`);
    await page.getByRole('link', { name: 'Continue to my application or status' }).waitFor();
    assert.equal(redemptions, 1);
    await page.screenshot({ path: 'test-results/provider-entry-en-mobile.png', fullPage: true });

    const expiredContext = await nextContext(), expired = await expiredContext.newPage();
    expired.on('pageerror', error => errors.push(error.message));
    await expired.clock.install();
    await expired.route(`${apiUrl}/api/auth/otp/send`, async route => { const response = await route.fetch(); const data = await response.json(); await route.fulfill({ response, json: { ...data, expiresInSeconds: 2 } }); });
    await expired.goto(`${webUrl}/auth/login`);
    const secondPhone = `+1555${randomInt(1000000, 9999999)}`;
    await expired.getByRole('textbox', { name: 'Phone number', exact: true }).fill(secondPhone);
    await expired.getByRole('button', { name: 'Send verification code', exact: true }).click();
    await expired.getByRole('textbox', { name: 'Six-digit verification code', exact: true }).waitFor();
    await expired.clock.fastForward(3000);
    await expired.getByText('This code has expired. Request another code to continue.').waitFor();
    assert.equal(await expired.getByRole('button', { name: 'Verify & continue', exact: true }).isDisabled(), true);
    await expired.getByRole('button', { name: 'Use a different phone number' }).click();
    await expired.getByRole('textbox', { name: 'Phone number', exact: true }).waitFor();
    assert.equal(await expired.getByRole('button', { name: /Send another code in/ }).isDisabled(), true);
    await expired.clock.fastForward(30000);
    await expired.getByRole('button', { name: 'Send verification code', exact: true }).click();
    await expired.getByText('Too many attempts. Wait before requesting or checking another code.').waitFor();
    // Reset retains the cooldown and its timer. Advancing a client clock never bypasses server quotas.

    const emailContext = await nextContext(), entry = await emailContext.newPage();
    entry.on('pageerror', error => errors.push(error.message));
    const email = `ui-return-${run}@example.test`;
    await entry.goto(`${webUrl}/auth/email?returnTo=${encodeURIComponent('/register/provider')}`);
    await entry.getByRole('textbox', { name: 'Email address', exact: true }).fill(email);
    const sentEmail = entry.waitForResponse(response => response.url() === `${apiUrl}/v1/auth/email-challenges` && response.request().method() === 'POST');
    await entry.getByRole('button', { name: 'Email me a sign-in link', exact: true }).click();
    assert.equal((await sentEmail).status(), 202);
    const mailbox = await (await fetch(`${apiUrl}/__dev/mailbox?email=${encodeURIComponent(email)}`)).json() as { link: string };
    assert.equal(new URL(mailbox.link).searchParams.get('returnTo'), '/register/provider');
    const callback = await emailContext.newPage(); callback.on('pageerror', error => errors.push(error.message));
    await callback.goto(mailbox.link);
    await callback.getByRole('button', { name: 'Verify sign-in', exact: true }).click();
    await callback.waitForURL(`${webUrl}/register/provider`);
    const emailMe = await (await emailContext.request.get(`${apiUrl}/api/auth/me`)).json(); identityIds.push(emailMe.profile.id);
    assert.equal(emailMe.profile.is_provider, false);
    assert.deepEqual(errors, []);
    console.log('PASS: provider registration reuses one identity; phone cooldown/expiry/server throttle and double-submit/profile recovery; email return context survives a new tab.');
  } finally { await Promise.all(contexts.map(value => value.close())); }
}
