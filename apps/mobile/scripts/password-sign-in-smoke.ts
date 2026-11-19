import assert from 'node:assert/strict';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { prisma as Prisma } from '../../api/src/db/client.js';
import { tokens } from '../src/design/tokens';
type Options = { browser: Browser; webUrl: string; apiUrl: string; prisma: typeof Prisma; run: string; identityIds: string[] };
// Email+password sign-in (decisions.md, 2026-11-01): customers and providers sign up the same way, and
// sign-up proves the email with a six-digit code first (login-plan-stage-2.md, slice 1).
export async function passwordSignInSmoke({ browser, webUrl, apiUrl, prisma, run, identityIds }: Options) {
  const contexts: BrowserContext[] = [];
  const password = `smoke-${run}-password`;
  async function fresh() {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(context);
    await context.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en'));
    const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    return { page, errors };
  }
  /** Fills the form and sends it; returns what the local inbox received: a code, or none for a registered address. */
  async function signUp(page: Page, name: string, email: string) {
    await page.getByLabel('Full name', { exact: true }).filter({ visible: true }).fill(name);
    await page.getByLabel('Email', { exact: true }).filter({ visible: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).filter({ visible: true }).fill(password);
    const started = page.waitForResponse(response => response.url().endsWith('/v1/auth/password/sign-up') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create account', exact: true }).filter({ visible: true }).click();
    const response = await started; assert.equal(response.status(), 202);
    const { signUp: handle } = await response.json() as { signUp: string };
    await page.getByText(`We sent a six-digit code to`, { exact: false }).filter({ visible: true }).waitFor();
    assert.equal(new URL(page.url()).href.includes(handle), false, 'The pending sign-up must never reach the URL.');
    const local = await page.request.post(`${apiUrl}/__dev/sign-up-code`, { headers: { Origin: webUrl }, data: { signUp: handle } });
    assert.equal(local.status(), 200);
    return (await local.json() as { code: string | null }).code;
  }
  async function enterCode(page: Page, code: string) {
    await page.getByLabel('Six-digit verification code', { exact: true }).filter({ visible: true }).fill(code);
    await page.getByRole('button', { name: 'Verify & create account', exact: true }).filter({ visible: true }).click();
  }
  async function signUpAndVerify(page: Page, name: string, email: string) {
    const code = await signUp(page, name, email); assert.ok(code, 'A new address receives a code.');
    assert.equal(await prisma.identity.count({ where: { email } }), 0, 'No account exists before the code.');
    await enterCode(page, String((Number(code) + 1) % 1000000).padStart(6, '0'));
    await page.getByRole('alert').filter({ hasText: 'The code is incorrect. Check it and try again.' }).waitFor();
    await enterCode(page, code);
  }
  async function owned(email: string) {
    const person = await prisma.identity.findUniqueOrThrow({ where: { email }, include: { passwordCredential: true } }); identityIds.push(person.id);
    return person;
  }
  try {
    const customer = await fresh(), customerEmail = `password-customer-${run}@example.test`;
    await customer.page.goto(`${webUrl}/`); await customer.page.waitForURL(`${webUrl}/auth/login`);
    const emailField = customer.page.getByLabel('Email', { exact: true }).filter({ visible: true });
    const placeholder = await emailField.evaluate(element => getComputedStyle(element, '::placeholder').color);
    const typed = await emailField.evaluate(element => getComputedStyle(element).color);
    assert.notEqual(placeholder, typed, 'A placeholder must not look like typed text.');
    assert.equal(placeholder, `rgb(${tokens.color.disabled.slice(1).match(/../g)!.map(pair => parseInt(pair, 16)).join(', ')})`);
    await customer.page.getByRole('link', { name: "Don't have an account? Create one", exact: true }).filter({ visible: true }).click(); await customer.page.waitForURL(`${webUrl}/auth/sign-up`);
    await signUpAndVerify(customer.page, 'Password Customer', customerEmail);
    await customer.page.waitForURL(`${webUrl}/`); await customer.page.getByTestId('home-screen').filter({ visible: true }).waitFor();
    const person = await owned(customerEmail);
    assert.ok(person.emailVerifiedAt); assert.equal(person.displayName, 'Password Customer');
    assert.equal(person.passwordCredential?.unprovenEmail, null); assert.equal(person.passwordCredential?.hash.includes(password), false);

    await customer.page.getByRole('button', { name: 'Account', exact: true }).click(); await customer.page.getByRole('button', { name: 'Sign out', exact: true }).filter({ visible: true }).click(); await customer.page.waitForURL(`${webUrl}/auth/login`);
    await customer.page.getByLabel('Email', { exact: true }).filter({ visible: true }).fill(customerEmail);
    await customer.page.getByLabel('Password', { exact: true }).filter({ visible: true }).fill(`${password}-wrong`);
    await customer.page.getByRole('button', { name: 'Sign in', exact: true }).filter({ visible: true }).click();
    await customer.page.getByRole('alert').filter({ hasText: 'The email or password is incorrect.' }).waitFor();
    await customer.page.getByLabel('Password', { exact: true }).filter({ visible: true }).fill(password); await customer.page.getByLabel('Password', { exact: true }).filter({ visible: true }).press('Enter');
    await customer.page.waitForURL(`${webUrl}/`); await customer.page.getByTestId('home-screen').filter({ visible: true }).waitFor();

    // A registered address looks the same on screen; its inbox gets "you already have an account", not a code.
    // (Another registered address than the customer's, whose 30-second resend cooldown is still running.)
    const knownEmail = `password-known-${run}@example.test`;
    identityIds.push((await prisma.identity.create({ data: { email: knownEmail, emailVerifiedAt: new Date(), displayName: 'Known Person' } })).id);
    const duplicate = await fresh();
    await duplicate.page.goto(`${webUrl}/auth/sign-up`); assert.equal(await signUp(duplicate.page, 'Someone Else', knownEmail), null);
    await enterCode(duplicate.page, '000000');
    await duplicate.page.getByRole('alert').filter({ hasText: 'The code is incorrect. Check it and try again.' }).waitFor();
    const known = await prisma.identity.findUniqueOrThrow({ where: { email: knownEmail }, include: { passwordCredential: true } });
    assert.equal(known.displayName, 'Known Person'); assert.equal(known.passwordCredential, null);

    const provider = await fresh(), providerEmail = `password-provider-${run}@example.test`;
    await provider.page.goto(`${webUrl}/register/provider`);
    await provider.page.getByRole('link', { name: 'Sign in to apply', exact: true }).filter({ visible: true }).click();
    await provider.page.waitForURL(url => url.pathname === '/auth/login' && url.searchParams.get('returnTo') === '/register/provider');
    await provider.page.getByRole('link', { name: "Don't have an account? Create one", exact: true }).filter({ visible: true }).click();
    await provider.page.waitForURL(url => url.pathname === '/auth/sign-up' && url.searchParams.get('returnTo') === '/register/provider');
    await signUpAndVerify(provider.page, 'Password Provider', providerEmail);
    await provider.page.waitForURL(`${webUrl}/register/provider`);
    await provider.page.getByLabel('Business name', { exact: true }).filter({ visible: true }).waitFor();
    assert.equal((await owned(providerEmail)).platformRole, 'USER');

    assert.deepEqual([...customer.errors, ...duplicate.errors, ...provider.errors], []);
    console.log('PASS: email+password sign-up proves the email with a code before the account exists, a wrong code is refused, a registered address gets the same screen and no code, sign-in has one error for a wrong password, provider sign-up returns to the application, and placeholders look empty.');
  } finally { await Promise.all(contexts.map(c => c.close())); }
}
