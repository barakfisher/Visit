import assert from 'node:assert/strict';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { prisma as Prisma } from '../../api/src/db/client.js';
import { tokens } from '../src/design/tokens';
type Options = { browser: Browser; webUrl: string; prisma: typeof Prisma; run: string; identityIds: string[] };
// MVP email+password sign-in (decisions.md, 2026-11-01): customers and providers sign up the same way.
export async function passwordSignInSmoke({ browser, webUrl, prisma, run, identityIds }: Options) {
  const contexts: BrowserContext[] = [];
  const password = `smoke-${run}-password`;
  async function fresh() {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(context);
    await context.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en'));
    const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    return { page, errors };
  }
  async function signUp(page: Page, name: string, email: string) {
    await page.getByLabel('Full name', { exact: true }).filter({ visible: true }).fill(name);
    await page.getByLabel('Email', { exact: true }).filter({ visible: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).filter({ visible: true }).fill(password);
    await page.getByRole('button', { name: 'Create account', exact: true }).filter({ visible: true }).click();
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
    await signUp(customer.page, 'Password Customer', customerEmail);
    await customer.page.waitForURL(`${webUrl}/`); await customer.page.getByTestId('home-screen').filter({ visible: true }).waitFor();
    const person = await owned(customerEmail);
    assert.ok(person.emailVerifiedAt); assert.equal(person.displayName, 'Password Customer');
    assert.equal(person.passwordCredential?.unprovenEmail, customerEmail); assert.equal(person.passwordCredential?.hash.includes(password), false);

    await customer.page.getByRole('button', { name: 'Account', exact: true }).click(); await customer.page.getByRole('button', { name: 'Sign out', exact: true }).filter({ visible: true }).click(); await customer.page.waitForURL(`${webUrl}/auth/login`);
    await customer.page.getByLabel('Email', { exact: true }).filter({ visible: true }).fill(customerEmail);
    await customer.page.getByLabel('Password', { exact: true }).filter({ visible: true }).fill(`${password}-wrong`);
    await customer.page.getByRole('button', { name: 'Sign in', exact: true }).filter({ visible: true }).click();
    await customer.page.getByRole('alert').filter({ hasText: 'The email or password is incorrect.' }).waitFor();
    await customer.page.getByLabel('Password', { exact: true }).filter({ visible: true }).fill(password); await customer.page.getByLabel('Password', { exact: true }).filter({ visible: true }).press('Enter');
    await customer.page.waitForURL(`${webUrl}/`); await customer.page.getByTestId('home-screen').filter({ visible: true }).waitFor();

    const duplicate = await fresh();
    await duplicate.page.goto(`${webUrl}/auth/sign-up`); await signUp(duplicate.page, 'Someone Else', customerEmail);
    await duplicate.page.getByRole('alert').filter({ hasText: 'An account with this email already exists. Sign in instead.' }).waitFor();
    assert.equal((await prisma.identity.findUniqueOrThrow({ where: { email: customerEmail } })).displayName, 'Password Customer');

    const provider = await fresh(), providerEmail = `password-provider-${run}@example.test`;
    await provider.page.goto(`${webUrl}/register/provider`);
    await provider.page.getByRole('link', { name: 'Sign in to apply', exact: true }).filter({ visible: true }).click();
    await provider.page.waitForURL(url => url.pathname === '/auth/login' && url.searchParams.get('returnTo') === '/register/provider');
    await provider.page.getByRole('link', { name: "Don't have an account? Create one", exact: true }).filter({ visible: true }).click();
    await provider.page.waitForURL(url => url.pathname === '/auth/sign-up' && url.searchParams.get('returnTo') === '/register/provider');
    await signUp(provider.page, 'Password Provider', providerEmail);
    await provider.page.waitForURL(`${webUrl}/register/provider`);
    await provider.page.getByLabel('Business name', { exact: true }).filter({ visible: true }).waitFor();
    assert.equal((await owned(providerEmail)).platformRole, 'USER');

    assert.deepEqual([...customer.errors, ...duplicate.errors, ...provider.errors], []);
    console.log('PASS: email+password sign-up and sign-in, one error for a wrong password, duplicate email refused without changes, provider sign-up returns to the application, and placeholders look empty.');
  } finally { await Promise.all(contexts.map(c => c.close())); }
}
