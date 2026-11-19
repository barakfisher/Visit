import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { prisma as Prisma } from '../../api/src/db/client.js';
import type { redis as Redis } from '../../api/src/infra/redis.js';
import type { SignUpDelivery } from '../../api/src/security/sign-up-delivery.js';
import { tokens } from '../src/design/tokens';
type Options = { browser: Browser; webUrl: string; prisma: typeof Prisma; redis: typeof Redis; run: string; identityIds: string[]; signUpInbox: SignUpDelivery; signUpNamespace: string };
// Email+password sign-in; sign-up proves the email with a code first (login-plan-stage-2.md, slice 1).
// Customers and providers sign up the same way. Sign-up mail goes to the injected local inbox.
export async function passwordSignInSmoke({ browser, webUrl, prisma, redis, run, identityIds, signUpInbox, signUpNamespace }: Options) {
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
    await page.getByText('We sent a six-digit code to:', { exact: true }).filter({ visible: true }).waitFor();
    assert.equal(await page.getByTestId('sign-up-email').filter({ visible: true }).textContent(), `\u2066${email}\u2069`);
  }
  async function inbox(email: string) {
    const row = await prisma.pendingSignUp.findFirstOrThrow({ where: { email, consumedAt: null, deliveredAt: { not: null } }, orderBy: { createdAt: 'desc' } });
    const message = signUpInbox.localMessage?.(row.id); assert.ok(message, `No local sign-up email for ${email}.`); return message;
  }
  async function enterCode(page: Page, email: string) {
    const message = await inbox(email); assert.equal(message.kind, 'code');
    await page.getByLabel('Six-digit verification code', { exact: true }).filter({ visible: true }).fill(message.code);
    await page.getByRole('button', { name: 'Verify & create account', exact: true }).filter({ visible: true }).click();
  }
  // Repeated sign-ups for one address within the cooldown would be refused, as they should be.
  const clearCooldown = (email: string) => redis.del(`${signUpNamespace}:sign-up:address:${createHash('sha256').update(email).digest('hex')}:cooldown`);
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
    await signUp(customer.page, 'Password Customer', `changed-${customerEmail}`);
    // Changing the address keeps every field; nothing exists until a code is right.
    await customer.page.getByRole('button', { name: 'Change email address', exact: true }).filter({ visible: true }).click();
    assert.equal(await customer.page.getByLabel('Full name', { exact: true }).filter({ visible: true }).inputValue(), 'Password Customer');
    assert.equal(await prisma.identity.count({ where: { email: { in: [customerEmail, `changed-${customerEmail}`] } } }), 0);
    await signUp(customer.page, 'Password Customer', customerEmail);
    await customer.page.getByRole('button', { name: /^Send another code in \d+s$/ }).filter({ visible: true }).waitFor();
    assert.equal(await customer.page.getByRole('button', { name: /^Send another code in \d+s$/ }).filter({ visible: true }).getAttribute('aria-disabled'), 'true');
    const realCode = await inbox(customerEmail); assert.equal(realCode.kind, 'code');
    await customer.page.getByLabel('Six-digit verification code', { exact: true }).filter({ visible: true }).fill(realCode.code === '000000' ? '111111' : '000000');
    await customer.page.getByRole('button', { name: 'Verify & create account', exact: true }).filter({ visible: true }).click();
    await customer.page.getByRole('alert').filter({ hasText: 'The code is incorrect. Check it and try again.' }).waitFor();
    assert.equal(await prisma.identity.count({ where: { email: customerEmail } }), 0);
    await enterCode(customer.page, customerEmail);
    await customer.page.waitForURL(`${webUrl}/`); await customer.page.getByTestId('home-screen').filter({ visible: true }).waitFor();
    const person = await owned(customerEmail);
    assert.ok(person.emailVerifiedAt); assert.equal(person.displayName, 'Password Customer'); assert.equal(person.preferredLocale, 'en');
    assert.equal(person.passwordCredential?.unprovenEmail, null); assert.equal(person.passwordCredential?.hash.includes(password), false);

    await customer.page.getByRole('button', { name: 'Account', exact: true }).click(); await customer.page.getByRole('button', { name: 'Sign out', exact: true }).filter({ visible: true }).click(); await customer.page.waitForURL(`${webUrl}/auth/login`);
    await customer.page.getByLabel('Email', { exact: true }).filter({ visible: true }).fill(customerEmail);
    await customer.page.getByLabel('Password', { exact: true }).filter({ visible: true }).fill(`${password}-wrong`);
    await customer.page.getByRole('button', { name: 'Sign in', exact: true }).filter({ visible: true }).click();
    await customer.page.getByRole('alert').filter({ hasText: 'The email or password is incorrect.' }).waitFor();
    await customer.page.getByLabel('Password', { exact: true }).filter({ visible: true }).fill(password); await customer.page.getByLabel('Password', { exact: true }).filter({ visible: true }).press('Enter');
    await customer.page.waitForURL(`${webUrl}/`); await customer.page.getByTestId('home-screen').filter({ visible: true }).waitFor();

    const duplicate = await fresh();
    // A registered address looks exactly like a new one on screen; its owner is emailed "you already have an account".
    await clearCooldown(customerEmail);
    await duplicate.page.goto(`${webUrl}/auth/sign-up`); await signUp(duplicate.page, 'Someone Else', customerEmail);
    assert.equal((await inbox(customerEmail)).kind, 'existing-account');
    await duplicate.page.getByLabel('Six-digit verification code', { exact: true }).filter({ visible: true }).fill('123456');
    await duplicate.page.getByRole('button', { name: 'Verify & create account', exact: true }).filter({ visible: true }).click();
    await duplicate.page.getByRole('alert').filter({ hasText: 'The code is incorrect. Check it and try again.' }).waitFor();
    assert.equal((await prisma.identity.findUniqueOrThrow({ where: { email: customerEmail } })).displayName, 'Password Customer');

    const provider = await fresh(), providerEmail = `password-provider-${run}@example.test`;
    await provider.page.goto(`${webUrl}/register/provider`);
    await provider.page.getByRole('link', { name: 'Sign in to apply', exact: true }).filter({ visible: true }).click();
    await provider.page.waitForURL(url => url.pathname === '/auth/login' && url.searchParams.get('returnTo') === '/register/provider');
    await provider.page.getByRole('link', { name: "Don't have an account? Create one", exact: true }).filter({ visible: true }).click();
    await provider.page.waitForURL(url => url.pathname === '/auth/sign-up' && url.searchParams.get('returnTo') === '/register/provider');
    await signUp(provider.page, 'Password Provider', providerEmail); await enterCode(provider.page, providerEmail);
    await provider.page.waitForURL(`${webUrl}/register/provider`);
    await provider.page.getByLabel('Business name', { exact: true }).filter({ visible: true }).waitFor();
    assert.equal((await owned(providerEmail)).platformRole, 'USER');

    assert.deepEqual([...customer.errors, ...duplicate.errors, ...provider.errors], []);
    console.log('PASS: sign-up proves the email with a code before the account exists (change address keeps the form, resend waits, a wrong code is refused), a registered address looks the same and stays unchanged, sign-in gives one error for a wrong password, provider sign-up returns to the application, and placeholders look empty.');
  } finally {
    await Promise.all(contexts.map(c => c.close()));
    await prisma.pendingSignUp.deleteMany({ where: { email: { contains: run } } });
  }
}
