import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID, randomInt, createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, BrowserContext } from 'playwright';
import dotenv from 'dotenv';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(appRoot, '../..');
dotenv.config({ path: path.join(repoRoot, '.env') });
const apiUrl = 'http://127.0.0.1:3001';
const webPort = 8082;
const webUrl = `http://127.0.0.1:${webPort}`;
Object.assign(process.env, { API_PORT: '3001', API_HOST: '127.0.0.1', NODE_ENV: 'development', SMS_DELIVERY_MODE: 'local-inbox', EMAIL_DELIVERY_MODE: 'local-inbox', EXPO_PUBLIC_API_URL: apiUrl, WEB_APP_URL: webUrl });
const { prisma } = await import('../../api/src/db/client.js');
const { redis } = await import('../../api/src/infra/redis.js');
const { chromium } = await import('playwright');
const run = randomUUID();
const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
let apiServer: Awaited<ReturnType<typeof import('../../api/src/app.js').createApp>> | undefined, webProcess: ChildProcess | undefined;
const googleClaims = new Map<string, Record<string, unknown>>();
const googleNamespace = `test:google-web:${run}`;
const accountNamespace = `test:account-web:${run}`;
const businessIds: string[] = [], identityIds: string[] = [];
const contexts: BrowserContext[] = [];
let capture: Page | undefined;
const pageErrors: string[] = [];
const diagnostics = path.join(appRoot, 'test-results');

async function available(port: number) {
  await new Promise<void>((resolve, reject) => { const server = createServer(); server.once('error', () => reject(new Error(`Test port ${port} is occupied; stop that test server before running.`))); server.listen(port, '127.0.0.1', () => server.close(() => resolve())); });
}
async function ready(url: string, child: ChildProcess, label: string) {
  const until = Date.now() + 60000;
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`${label} exited (${child.exitCode}).`);
    try { if ((await fetch(url)).ok) return; } catch { /* Wait for startup. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} startup timed out.`);
}
async function otpLogin(page: Page, phone: string, provider = false) {
  await page.goto(`${webUrl}/auth/login`);
  await page.getByRole('heading', { name: 'Welcome to Visit' }).waitFor();
  await page.getByLabel('Phone number', { exact: true }).fill(phone);
  await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
  const otp = page.getByLabel('Six-digit verification code');
  await otp.waitFor(); assert.equal(await otp.getAttribute('autocomplete'), 'one-time-code');
  const response = await fetch(`${apiUrl}/__dev/otp?phone=${encodeURIComponent(phone)}`);
  assert.equal(response.status, 200);
  const { code } = await response.json() as { code: string };
  await otp.fill(code);
  await page.getByRole('button', { name: 'Verify & continue' }).click();
  await page.waitForURL(provider ? '**/provider/dashboard' : '**/discover');
}
async function openBooking(page: Page, businessId: string, serviceId: string) {
  await page.goto(`${webUrl}/booking/${businessId}?serviceId=${serviceId}&date=${date}`);
  await page.getByRole('heading', { name: 'Available appointments' }).waitFor();
  await page.getByRole('button', { name: /09:00 · Alex North/ }).waitFor();
}
try {
  await available(3001); await available(webPort); await mkdir(diagnostics, { recursive: true });
  if (redis.status === 'wait') await redis.connect();
  // Only the local test IP's OTP counters are reset; fixture phone numbers are unique.
  const ipHash = createHash('sha256').update('127.0.0.1').digest('hex');
  await redis.del(`visit:otp:limit:ip:${ipHash}`, `visit:otp:limit:verify-ip:${ipHash}`, `visit:email:limit:ip:${ipHash}`, `visit:email:limit:verify:${ipHash}`);
  const { createApp } = await import('../../api/src/app.js');
  const { createGoogleAuthService } = await import('../../api/src/security/google-auth.js');
  const google = createGoogleAuthService({ namespace: googleNamespace, config: { clientId: 'web-test-client', clientSecret: 'web-test-secret', callbackUrl: `${apiUrl}/api/auth/google/callback`, webOrigin: webUrl }, provider: { exchange: async ({ code }) => { const claims = googleClaims.get(code); googleClaims.delete(code); if (!claims) throw new Error('Invalid synthetic code'); return claims; } } });
  // Production routes/services, with only the external Google provider boundary substituted.
  const { createAccountMethodsService } = await import('../../api/src/security/account-methods.js');
  const { createLocalAccountDelivery } = await import('../../api/src/security/account-delivery.js');
  const { createOtpService } = await import('../../api/src/security/phone-otp.js');
  const account = createAccountMethodsService({ namespace: accountNamespace, delivery: createLocalAccountDelivery(), otp: createOtpService({ mode: 'local-inbox', namespace: `${accountNamespace}:otp`, secret: 'web-test-only-account-otp-secret' }) });
  apiServer = await createApp({ google, account });
  await apiServer.listen({ host: '127.0.0.1', port: 3001 });
  assert.equal((await fetch(`${apiUrl}/health/ready`)).status, 200);
  for (const name of ['North', 'South']) {
    const business = await prisma.business.create({ data: { name: `Visit QA ${name} ${run.slice(0, 6)}`, slug: `qa-${name.toLowerCase()}-${run}`, timezone: 'UTC', location: name === 'North' ? 'Jerusalem' : 'Tel Aviv', category: 'Wellness', approvalStatus: 'APPROVED' } });
    businessIds.push(business.id);
    const service = await prisma.service.create({ data: { businessId: business.id, name: name === 'North' ? 'QA consultation' : 'South consultation', durationMinutes: 30, priceMinor: 6500, currency: 'USD' } });
    const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: name === 'North' ? 'Alex North' : 'Sam South', parallelCapacity: 1 } });
    await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
    await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
    await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '09:00', endLocal: '17:00' })) });
  }
  const identities = await Promise.all(['consumer-a', 'consumer-b', 'owner'].map((name) => prisma.identity.create({ data: { email: `${name}-${run}@example.test`, phone: `+1555${randomInt(1000000, 9999999)}` } })));
  identityIds.push(...identities.map((identity) => identity.id));
  await prisma.membership.createMany({ data: businessIds.map(businessId => ({ identityId: identities[2]!.id, businessId, status: 'ACTIVE' as const, role: 'OWNER' as const })) });
  const service = await prisma.service.findFirstOrThrow({ where: { businessId: businessIds[0]! } });
  webProcess = spawn(process.execPath, [path.join(repoRoot, 'node_modules/expo/bin/cli'), 'serve', 'dist', '--port', String(webPort)], { cwd: appRoot, env: { ...process.env, NODE_PATH: path.join(appRoot, 'node_modules') }, stdio: 'ignore' });
  await ready(webUrl, webProcess, 'Web');
  const browser = await chromium.launch({ headless: true });
  try {
    const { googleSmoke } = await import('./google-smoke.js');
    await googleSmoke({ browser, webUrl, apiUrl, claims: googleClaims, run, prisma, identityIds });
    const localization = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(localization);
    const localePage = await localization.newPage(); capture = localePage;
    localePage.on('pageerror', error => pageErrors.push(error.message));
    await localePage.goto(`${webUrl}/auth/login`);
    await localePage.getByRole('heading', { name: 'ברוכים הבאים ל־Visit' }).waitFor();
    assert.equal(await localePage.locator('link[rel=manifest]').getAttribute('href'), '/manifest.json');
    const manifestResponse = await fetch(`${webUrl}/manifest.json`);
    const manifest = await manifestResponse.json() as { icons: { src: string }[]; display: string };
    assert.equal(manifest.display, 'standalone');
    for (const icon of manifest.icons) assert.equal((await fetch(`${webUrl}${icon.src}`)).status, 200);
    assert.equal((await fetch(`${apiUrl}/api/providers`)).headers.get('cache-control'), 'no-store');
    assert.deepEqual(await localePage.evaluate(async () => ({ caches: await caches.keys(), registrations: (await navigator.serviceWorker.getRegistrations()).length })), { caches: [], registrations: 0 });
    console.log('PASS: linked PWA manifest/icons, network-only shell and no-store API response policy.');
    assert.equal(await localePage.locator('html').getAttribute('lang'), 'he');
    assert.equal(await localePage.locator('html').getAttribute('dir'), 'rtl');
    assert.equal(await localePage.getByLabel('מספר טלפון', { exact: true }).evaluate(node => getComputedStyle(node).direction), 'ltr');
    await localePage.screenshot({ path: path.join(diagnostics, 'login-he-mobile.png'), fullPage: true });
    await localePage.setViewportSize({ width: 1280, height: 900 });
    await localePage.screenshot({ path: path.join(diagnostics, 'login-he-desktop.png'), fullPage: true });
    await localePage.goto(`${webUrl}/auth/email`);
    await localePage.getByRole('heading', { name: 'כניסה בדואר אלקטרוני', exact: true }).waitFor();
    assert.equal(await localePage.getByLabel('כתובת דואר אלקטרוני', { exact: true }).evaluate(node => getComputedStyle(node).direction), 'ltr');
    assert.equal(await localePage.getByRole('button', { name: 'שליחת קישור לכניסה', exact: true }).isDisabled(), true);
    await localePage.goto(`${webUrl}/two`);
    await localePage.getByTestId('language-en').click();
    await localePage.getByRole('heading', { name: 'Account', exact: true }).waitFor();
    assert.equal(await localePage.locator('html').getAttribute('dir'), 'ltr');
    await localePage.reload();
    await localePage.getByRole('heading', { name: 'Account', exact: true }).waitFor();
    await localePage.goto(`${webUrl}/auth/login`);
    await localePage.getByRole('heading', { name: 'Welcome to Visit' }).waitFor();
    await localePage.screenshot({ path: path.join(diagnostics, 'login-en-desktop.png'), fullPage: true });
    await localePage.setViewportSize({ width: 390, height: 844 });
    await localePage.screenshot({ path: path.join(diagnostics, 'login-en-mobile.png'), fullPage: true });
    console.log('PASS: Hebrew default/RTL, LTR phone input, language switching and guest preference persistence at mobile/desktop sizes.');

    const consumer = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(consumer);
    await consumer.addInitScript(() => { if (!localStorage.getItem('visit.locale.v1.guest')) localStorage.setItem('visit.locale.v1.guest', 'en'); });
    const page = await consumer.newPage(); capture = page; page.on('pageerror', (error) => pageErrors.push(error.message));
    await otpLogin(page, identities[0]!.phone!);
    // Settle login bootstrap before injecting expiry; otherwise a hard navigation
    // can abandon a rotation already started by the previous document.
    await page.waitForLoadState('networkidle');
    const originalCookie = (await consumer.cookies()).find(cookie => cookie.name === 'visit_session')!;
    await prisma.session.update({ where: { tokenHash: createHash('sha256').update(originalCookie.value).digest('hex') }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const rotatedResponse = page.waitForResponse(response => response.url().endsWith('/v1/auth/refresh') && response.status() === 200);
    await page.goto(`${webUrl}/two`); await rotatedResponse;
    await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
    assert.notEqual((await consumer.cookies()).find(cookie => cookie.name === 'visit_session')!.value, originalCookie.value);
    assert.equal(await page.evaluate(() => localStorage.getItem('visit.session-token')), null);
    console.log('PASS: expired access refreshes through the HttpOnly cookie without ordinary token storage.');
    await page.goto(`${webUrl}/discover`);
    await page.getByLabel('Search businesses').fill(`Visit QA North ${run.slice(0, 6)}`);
    await page.locator(`a[href="/booking/${businessIds[0]}"]`).click();
    await page.getByRole('heading', { name: 'Available appointments' }).waitFor();
    await page.getByRole('button', { name: /QA consultation/ }).click();
    const dateResponse = page.waitForResponse((response) => response.url().includes('/availability?') && response.url().includes(`date=${date}`));
    await page.getByLabel('Appointment date', { exact: true }).fill(date); await dateResponse;
    const lockResponse = page.waitForResponse((response) => response.url().endsWith('/api/bookings/lock-slot'));
    await page.getByRole('button', { name: /09:00 · Alex North/ }).click();
    const holdResponse = await lockResponse; assert.equal(holdResponse.status(), 201);
    const hold = await holdResponse.json(); assert.ok(await redis.get(`visit:hold:${hold.holdId}`));
    await page.getByText(/Slot held for \d\d:\d\d mins/).waitFor();
    await page.screenshot({ path: path.join(diagnostics, 'booking-hold-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: 'Confirm & Book Appointment', exact: true }).click();
    await page.getByRole('heading', { name: 'You’re all set' }).waitFor();
    assert.equal(await prisma.booking.count({ where: { id: hold.holdId, status: 'CONFIRMED' } }), 1);
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Add to calendar (.ics)' }).click();
    const calendarFile = await download; const calendar = await readFile((await calendarFile.path())!, 'utf8'); assert.ok(calendar.includes(`UID:${hold.holdId}@visit.app`));
    console.log('PASS: full consumer journey, Redis hold, confirmation, and calendar export.');

    const owner = await browser.newContext({ viewport: { width: 1280, height: 900 } }); contexts.push(owner);
    await owner.addInitScript(() => { if (!localStorage.getItem('visit.locale.v1.guest')) localStorage.setItem('visit.locale.v1.guest', 'en'); });
    const providerPage = await owner.newPage(); capture = providerPage; providerPage.on('pageerror', (error) => pageErrors.push(error.message));
    await otpLogin(providerPage, identities[2]!.phone!, true);
    await providerPage.getByRole('button', { name: `Visit QA North ${run.slice(0, 6)}`, exact: true }).click();
    await providerPage.getByLabel('Agenda date').fill(date);
    await providerPage.getByText('QA consultation', { exact: true }).waitFor();
    await providerPage.getByRole('button', { name: 'Call', exact: true }).waitFor();
    await providerPage.screenshot({ path: path.join(diagnostics, 'provider-agenda-desktop.png'), fullPage: true });
    await providerPage.getByRole('button', { name: 'Block time / add a break' }).click();
    await providerPage.getByLabel('Break start time').fill('10:00'); await providerPage.getByLabel('Break end time').fill('10:30');
    await providerPage.getByRole('button', { name: 'Save blocked time' }).click();
    await providerPage.getByRole('button', { name: 'Remove blocked time' }).waitFor();
    console.log('PASS: approved-provider smart routing, agenda verification and manual break.');
    await providerPage.getByRole('tab', { name: 'Service Catalog', exact: true }).click();
    // Hold an old-workspace response across the switch. Late replies must not
    // restore the old private catalog or its draft after Query cancellation.
    const northCatalogUrl = `${apiUrl}/v1/provider/businesses/${businessIds[0]}/services`;
    let releaseOld!: () => void, observedOld!: () => void, finishedOld!: () => void;
    const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
    const oldObserved = new Promise<void>(resolve => { observedOld = resolve; });
    const oldFinished = new Promise<void>(resolve => { finishedOld = resolve; });
    const oldDeadline = setTimeout(releaseOld, 12000);
    const delayOld = async (route: import('playwright').Route) => {
      try { const response = await route.fetch(); observedOld(); await oldGate; await route.fulfill({ response }).catch(() => {}); }
      finally { finishedOld(); }
    };
    await providerPage.route(northCatalogUrl, delayOld);
    try {
      // Switching away and back clears the fresh 15s query cache, guaranteeing
      // a real new North request without waiting for a stale-time timer.
      await providerPage.getByRole('button', { name: `Visit QA South ${run.slice(0, 6)}`, exact: true }).click();
      await providerPage.getByRole('tab', { name: 'Service Catalog', exact: true }).click();
      await providerPage.getByText('South consultation', { exact: true }).waitFor();
      await providerPage.getByRole('button', { name: `Visit QA North ${run.slice(0, 6)}`, exact: true }).click();
      await providerPage.getByRole('tab', { name: 'Service Catalog', exact: true }).click();
      await Promise.race([oldObserved, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('Old catalog request was not observed')), 10000); oldObserved.then(() => clearTimeout(timer)); })]);
      await providerPage.getByLabel('Service name', { exact: true }).fill('Unsaved North draft');
    await providerPage.getByRole('button', { name: `Visit QA South ${run.slice(0, 6)}`, exact: true }).click();
    await providerPage.getByRole('tab', { name: 'Service Catalog', exact: true }).click();
    await providerPage.getByText('South consultation', { exact: true }).waitFor();
    assert.equal(await providerPage.getByLabel('Service name', { exact: true }).inputValue(), '');
    assert.equal(await providerPage.getByText('QA consultation', { exact: true }).count(), 0);
      releaseOld(); await oldFinished;
      // The agenda intentionally polls; global network-idle is not a reliable
      // completion condition. Drain browser render frames after fulfillment.
      await providerPage.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      assert.equal(await providerPage.getByText('QA consultation', { exact: true }).count(), 0);
      assert.equal(await providerPage.getByLabel('Service name', { exact: true }).inputValue(), '');
      assert.deepEqual(await providerPage.evaluate(async () => ({ caches: await caches.keys(), registrations: (await navigator.serviceWorker.getRegistrations()).length })), { caches: [], registrations: 0 });
      const storage = await providerPage.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
      assert.equal(storage.includes('Unsaved North draft') || storage.includes('QA consultation') || storage.includes('South consultation'), false);
    } finally { clearTimeout(oldDeadline); releaseOld(); await providerPage.unroute(northCatalogUrl, delayOld); }

    await providerPage.getByRole('button', { name: `Visit QA North ${run.slice(0, 6)}`, exact: true }).click();
    await providerPage.getByRole('tab', { name: 'Service Catalog', exact: true }).click();
    await providerPage.getByText('QA consultation', { exact: true }).waitFor();
    assert.equal(await providerPage.getByLabel('Service name', { exact: true }).inputValue(), '');
    console.log('PASS: business switching discards delayed old-workspace responses, clears drafts, and leaves browser caches/private storage empty.');
    const catalogBase = `${apiUrl}/v1/provider/businesses/${businessIds[0]}/services`;
    const form = providerPage.getByTestId('service-form');
    await form.getByLabel('Service name', { exact: true }).fill('QA exact-money service');
    await form.getByLabel('Duration in minutes', { exact: true }).fill('0');
    await form.getByLabel('Price', { exact: true }).fill('19.999');
    await form.getByRole('button', { name: 'Add service', exact: true }).click();
    await form.getByText('Use a whole duration from 5 to 1,440 minutes.', { exact: true }).waitFor();
    await form.getByLabel('Duration in minutes', { exact: true }).fill('30');
    await form.getByLabel('Price', { exact: true }).fill('19.99');
    // Failed mutation preserves the draft, while pending state prevents double submission.
    let releaseSave!: () => void;
    const heldSave = new Promise<void>(resolve => { releaseSave = resolve; });
    let saveArrived!: () => void;
    const sawSave = new Promise<void>(resolve => { saveArrived = resolve; });
    await providerPage.route(catalogBase, async route => { if (route.request().method() !== 'POST') return route.continue(); saveArrived(); await heldSave; await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Unavailable' } }) }); });
    await form.getByRole('button', { name: 'Add service', exact: true }).click(); await sawSave;
    await providerPage.waitForFunction(() => (document.querySelector('input[aria-label="Service name"]') as HTMLInputElement | null)?.readOnly === true);
    assert.equal(await form.getByLabel('Service name', { exact: true }).isEditable(), false);
    releaseSave();
    await providerPage.getByText('Could not save changes. Your draft is still here. Please try again.', { exact: true }).waitFor();
    assert.equal(await form.getByLabel('Service name', { exact: true }).inputValue(), 'QA exact-money service');
    assert.equal(await form.getByLabel('Price', { exact: true }).inputValue(), '19.99');
    await providerPage.unroute(catalogBase);
    const createdService = providerPage.waitForResponse(response => response.url() === catalogBase && response.request().method() === 'POST');
    await form.getByRole('button', { name: 'Add service', exact: true }).click();
    const serviceResponse = await createdService; assert.equal(serviceResponse.status(), 201);
    const newService = await serviceResponse.json(); assert.equal(newService.priceMinor, 1999);
    const card = providerPage.getByTestId(`service-card-${newService.id}`);
    await card.getByRole('button', { name: 'Edit service', exact: true }).click();
    await form.getByLabel('Service name', { exact: true }).fill('QA revised service');
    await form.getByLabel('Duration in minutes', { exact: true }).fill('45');
    await form.getByRole('button', { name: 'Save changes', exact: true }).click();
    await card.getByText('QA revised service', { exact: true }).waitFor();
    await card.getByRole('button', { name: 'Archive', exact: true }).click();
    await card.getByRole('button', { name: 'Restore', exact: true }).waitFor();
    assert.equal((await (await fetch(`${apiUrl}/v1/businesses/${businessIds[0]}/services`)).json() as { services: { id: string }[] }).services.some(item => item.id === newService.id), false);
    await card.getByRole('button', { name: 'Restore', exact: true }).click();
    await card.getByRole('button', { name: 'Archive', exact: true }).waitFor();
    await card.getByRole('button', { name: 'Delete or archive', exact: true }).click();
    await card.getByRole('button', { name: 'Confirm deletion or archive', exact: true }).click();
    await providerPage.getByText('Service deleted.', { exact: true }).waitFor();
    assert.equal(await prisma.service.count({ where: { id: newService.id } }), 0);
    // Editing or removing a referenced service never rewrites an appointment's snapshot.
    const original = providerPage.getByTestId(`service-card-${service.id}`);
    await original.getByRole('button', { name: 'Edit service', exact: true }).click();
    await form.getByLabel('Service name', { exact: true }).fill('Repriced catalog label');
    await form.getByLabel('Price', { exact: true }).fill('99');
    await form.getByRole('button', { name: 'Save changes', exact: true }).click();
    await original.getByText('Repriced catalog label', { exact: true }).waitFor();
    await providerPage.getByRole('tab', { name: 'Agenda View', exact: true }).click();
    await providerPage.getByLabel('Agenda date').fill(date);
    await providerPage.getByText('QA consultation', { exact: true }).waitFor();
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: hold.holdId } })).servicePriceMinor, 6500);
    await providerPage.getByRole('tab', { name: 'Service Catalog', exact: true }).click();
    await original.getByRole('button', { name: 'Delete or archive', exact: true }).click();
    await original.getByRole('button', { name: 'Confirm deletion or archive', exact: true }).click();
    await providerPage.getByText('Service archived. Booking history is preserved.', { exact: true }).waitFor();
    await original.getByRole('button', { name: 'Restore', exact: true }).click();
    await original.getByRole('button', { name: 'Edit service', exact: true }).click();
    await form.getByLabel('Service name', { exact: true }).fill('QA consultation');
    await form.getByLabel('Price', { exact: true }).fill('65');
    await form.getByRole('button', { name: 'Save changes', exact: true }).click();
    await original.getByText('QA consultation', { exact: true }).waitFor();
    await providerPage.screenshot({ path: path.join(diagnostics, 'service-catalog-en-desktop.png'), fullPage: true });
    // The same editor works on the settings route and in Hebrew at mobile width.
    await providerPage.goto(`${webUrl}/two`);
    await providerPage.getByTestId('language-he').click();
    await providerPage.goto(`${webUrl}/provider/${businessIds[0]}`);
    await providerPage.setViewportSize({ width: 390, height: 844 });
    await providerPage.getByRole('heading', { name: 'קטלוג שירותים', exact: true }).waitFor();
    assert.equal(await providerPage.getByLabel('מחיר', { exact: true }).evaluate(node => getComputedStyle(node).direction), 'ltr');
    await providerPage.screenshot({ path: path.join(diagnostics, 'service-catalog-he-mobile.png'), fullPage: true });
    await providerPage.goto(`${webUrl}/two`); await providerPage.getByTestId('language-en').click();
    console.log('PASS: service create/edit/archive/restore/delete, exact prices, failed draft recovery, immutable agenda details and Hebrew mobile editor.');


    const rival = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(rival);
    await rival.addInitScript(() => { if (!localStorage.getItem('visit.locale.v1.guest')) localStorage.setItem('visit.locale.v1.guest', 'en'); });
    const pageB = await rival.newPage(); pageB.on('pageerror', (error) => pageErrors.push(error.message));
    await otpLogin(pageB, identities[1]!.phone!);
    await Promise.all([openBooking(page, businessIds[0]!, service.id), openBooking(pageB, businessIds[0]!, service.id)]);
    capture = pageB;
    assert.equal(await page.getByRole('button', { name: /10:00 · Alex North/ }).isDisabled(), true);
    let arrived = 0; let unblock!: () => void;
    const barrier = new Promise<void>((resolve) => { unblock = resolve; });
    const barrierTimeout = setTimeout(unblock, 10000);
    for (const contestant of [page, pageB]) await contestant.route('**/api/bookings/lock-slot', async (route) => { arrived++; if (arrived === 2) unblock(); await barrier; await route.continue(); });
    const replies = [page, pageB].map((contestant) => contestant.waitForResponse((response) => response.url().endsWith('/api/bookings/lock-slot')));
    await Promise.all([page, pageB].map((contestant) => contestant.getByRole('button', { name: /11:00 · Alex North/ }).click()));
    const results = await Promise.all(replies); clearTimeout(barrierTimeout);
    assert.equal(arrived, 2); assert.deepEqual(results.map((response) => response.status()).sort(), [201, 409]);
    const winnerIndex = results.findIndex((response) => response.status() === 201), winner = [page, pageB][winnerIndex]!, loser = [page, pageB][1 - winnerIndex]!;
    capture = loser;
    await loser.getByRole('alert').waitFor();
    await loser.waitForFunction(() => Array.from(document.querySelectorAll('[role="button"]')).some((element) => element.textContent?.includes('11:00 · Alex North') && element.getAttribute('aria-disabled') === 'true'));
    await loser.screenshot({ path: path.join(diagnostics, 'slot-conflict-mobile.png'), fullPage: true });
    await winner.getByRole('button', { name: 'Confirm & Book Appointment', exact: true }).click();
    await winner.getByRole('heading', { name: 'You’re all set' }).waitFor();
    assert.equal(await prisma.booking.count({ where: { businessId: businessIds[0]!, startsAt: new Date(`${date}T11:00:00Z`), status: 'CONFIRMED' } }), 1);
    console.log('PASS: two simultaneous browser contexts produce exactly one winner, one conflict, and a disabled slot.');

    // Existing appointment actions remain covered after the new screen flow.
    capture = page;
    await page.goto(`${webUrl}/booking/${businessIds[0]}?serviceId=${service.id}&date=${date}&fromBookingId=${hold.holdId}`);
    await page.getByRole('button', { name: /14:00 · Alex North/ }).click();
    await page.getByRole('button', { name: 'Confirm reschedule' }).click();
    await page.getByRole('heading', { name: 'You’re all set' }).waitFor();
    await page.goto(`${webUrl}/discover`);
    const currentBooking = page.locator(`[data-testid="active-booking-${hold.holdId}"]:visible`);
    await currentBooking.waitFor();
    await currentBooking.scrollIntoViewIfNeeded();
    page.once('dialog', (dialog) => dialog.accept());
    const cancelled = page.waitForResponse((response) => response.url().endsWith(`/${hold.holdId}/cancel`) && response.status() === 200);
    await currentBooking.getByRole('button', { name: 'Cancel', exact: true }).click(); await cancelled;
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: hold.holdId } })).status, 'CANCELLED');
    const emailContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(emailContext);
    await emailContext.addInitScript(() => { if (!localStorage.getItem('visit.locale.v1.guest')) localStorage.setItem('visit.locale.v1.guest', 'en'); });
    const emailPage = await emailContext.newPage(); capture = emailPage;
    const emailRequestUrls: string[] = []; let emailVerifications = 0;
    emailPage.on('pageerror', error => pageErrors.push(error.message));
    emailPage.on('request', request => { emailRequestUrls.push(request.url()); if (request.url().endsWith('/v1/auth/email-challenges/verify')) emailVerifications++; });
    await emailPage.goto(`${webUrl}/auth/login`);
    await emailPage.getByRole('link', { name: 'Continue with email', exact: true }).click();
    await emailPage.getByLabel('Email address').fill(identities[1]!.email!);
    await emailPage.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await emailPage.getByText(/If this address can sign in/).waitFor();
    const mail = await fetch(`${apiUrl}/__dev/mailbox?email=${encodeURIComponent(identities[1]!.email!)}`).then((response) => response.json()) as { token: string };
    await emailPage.goto(`${webUrl}/auth/email#token=${encodeURIComponent(mail.token)}`);
    await emailPage.getByRole('button', { name: 'Verify sign-in', exact: true }).waitFor();
    await emailPage.waitForFunction(() => window.location.hash.length === 0);
    assert.equal(new URL(emailPage.url()).hash.length === 0, true, 'email credential must be removed from the URL');
    assert.equal((await emailContext.request.get(`${apiUrl}/v1/me`)).status(), 401, 'opening a link must not consume it');
    assert.equal(await emailPage.getByLabel('One-time sign-in link token').count(), 0);
    assert.equal(await emailPage.evaluate(token => JSON.stringify(history.state).includes(token), mail.token), false);
    await emailPage.route('**/api/auth/me', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAVAILABLE' } }) }));
    await emailPage.getByRole('button', { name: 'Verify sign-in' }).click();
    await emailPage.getByRole('alert').filter({ hasText: 'This sign-in request could not be completed' }).waitFor();
    await emailPage.unroute('**/api/auth/me');
    await emailPage.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile: { id: 'unexpected-identity', email: null, phone: null, is_provider: false, businesses: [] } }) }));
    await emailPage.getByRole('button', { name: 'Verify sign-in' }).click();
    await emailPage.getByRole('alert').filter({ hasText: 'This sign-in request could not be completed' }).waitFor();
    assert.equal(new URL(emailPage.url()).pathname, '/auth/email');
    await emailPage.unroute('**/api/auth/me');
    await emailPage.getByRole('button', { name: 'Verify sign-in' }).click();
    await emailPage.waitForURL('**/discover');
    assert.equal(emailVerifications, 1, 'profile loading retry must not replay the one-time link');
    assert.equal(emailRequestUrls.some(url => url.includes(mail.token)), false);
    console.log('PASS: fragment link is scrubbed, opening does not authenticate, and profile outage recovery does not replay it.');
    console.log('PASS: email fallback completes authentication and routes to consumer discovery.');
    await emailPage.goto(`${webUrl}/two`);
    const languageSaved = emailPage.waitForResponse(response => response.url().endsWith('/api/account/preferences') && response.status() === 200);
    await emailPage.getByTestId('language-he').click();
    await languageSaved;
    await emailPage.getByRole('heading', { name: 'חשבון', exact: true }).waitFor();
    assert.equal((await prisma.identity.findUniqueOrThrow({ where: { id: identities[1]!.id } })).preferredLocale, 'he');
    // Same server session, fresh local storage: server preference must win over device defaults.
    const cookieState = await emailContext.cookies();
    const freshDevice = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(freshDevice);
    await freshDevice.addCookies(cookieState);
    await freshDevice.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en'));
    const freshPage = await freshDevice.newPage();
    await freshPage.goto(`${webUrl}/two`);
    await freshPage.getByRole('heading', { name: 'חשבון', exact: true }).waitFor();
    assert.equal(await freshPage.locator('html').getAttribute('dir'), 'rtl');
    console.log('PASS: authenticated language preference persists on the server and restores with fresh browser storage.');

    const rejectedLogout = await emailContext.request.post(`${apiUrl}/v1/auth/logout`, { headers: { Origin: 'https://attacker.example' } });
    assert.equal(rejectedLogout.status(), 403);
    assert.equal((await emailContext.request.get(`${apiUrl}/v1/me`)).status(), 200);
    await freshPage.route('**/v1/auth/logout', route => route.abort());
    await freshPage.getByRole('button', { name: 'יציאה מהחשבון', exact: true }).click();
    await freshPage.getByRole('alert').filter({ hasText: 'לא ניתן לצאת מהחשבון' }).waitFor();
    assert.equal((await freshDevice.request.get(`${apiUrl}/v1/me`)).status(), 200);
    await freshPage.unroute('**/v1/auth/logout');
    await freshPage.getByRole('button', { name: 'יציאה מהחשבון', exact: true }).click();
    await freshPage.waitForURL('**/auth/login');
    assert.equal((await freshDevice.cookies()).some(cookie => cookie.name === 'visit_session'), false);
    assert.equal((await emailContext.request.get(`${apiUrl}/v1/me`)).status(), 401);
    assert.equal((await owner.request.get(`${apiUrl}/v1/me`)).status(), 200);
    console.log('PASS: cross-origin logout is denied, outage preserves session, successful logout clears cookie and revokes only its login family.');

    const nextFall = new Date(Date.UTC(new Date().getUTCFullYear() + 1, 10, 1));
    nextFall.setUTCDate(1 + (7 - nextFall.getUTCDay()) % 7);
    const foldDate = nextFall.toISOString().slice(0, 10);
    const foldBusiness = await prisma.business.create({ data: { name: 'Synthetic DST studio', slug: `qa-fold-${run}`, timezone: 'America/New_York', approvalStatus: 'APPROVED' } });
    businessIds.push(foldBusiness.id);
    const foldService = await prisma.service.create({ data: { businessId: foldBusiness.id, name: 'DST consultation', durationMinutes: 30 } });
    const foldStaff = await prisma.staff.create({ data: { businessId: foldBusiness.id, displayName: 'Fold specialist' } });
    await prisma.staffService.create({ data: { businessId: foldBusiness.id, staffId: foldStaff.id, serviceId: foldService.id } });
    await prisma.businessWeeklyAvailability.create({ data: { businessId: foldBusiness.id, weekday: 0, startLocal: '00:00', endLocal: '04:00' } });
    await prisma.bookingPolicy.create({ data: { businessId: foldBusiness.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 730, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
    capture = providerPage;
    await providerPage.goto(`${webUrl}/booking/${foldBusiness.id}?serviceId=${foldService.id}&date=${foldDate}`);
    await providerPage.getByRole('button', { name: 'Confirm & Book Appointment', exact: true }).waitFor();
    await providerPage.getByRole('button', { name: /01:30 \(UTC-04:00\) · Fold specialist/ }).waitFor();
    const foldHoldResponse = providerPage.waitForResponse(response => response.url().endsWith('/api/bookings/lock-slot'));
    await providerPage.getByRole('button', { name: /01:30 \(UTC-05:00\) · Fold specialist/ }).click();
    const foldHold = await (await foldHoldResponse).json(); assert.equal(foldHold.startsAt, `${foldDate}T06:30:00.000Z`);
    await providerPage.getByRole('button', { name: 'Confirm & Book Appointment', exact: true }).click();
    await providerPage.getByRole('heading', { name: 'You’re all set' }).waitFor();
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: foldHold.holdId } })).startsAt.toISOString(), `${foldDate}T06:30:00.000Z`);
    console.log('PASS: two real DST-fold choices display distinct offsets and the selected second occurrence locks/confirms its exact UTC instant.');

    assert.deepEqual(pageErrors, []);
    console.log('PASS: reschedule, cancellation, and no browser runtime exceptions.');
  } catch (error) { if (capture) { console.error((await capture.locator('body').innerText()).slice(0, 3500)); await capture.screenshot({ path: path.join(diagnostics, 'web-smoke-failure.png'), fullPage: true }).catch(() => {}); } throw error; }
  finally { await Promise.all(contexts.map((context) => context.close())); await browser.close(); }
} finally {
  webProcess?.kill('SIGTERM'); await apiServer?.close();
  const accountKeys: string[] = []; for await (const batch of redis.scanStream({ match: `${accountNamespace}:*` })) accountKeys.push(...batch); if (accountKeys.length) await redis.del(...accountKeys);
  const googleKeys: string[] = []; for await (const batch of redis.scanStream({ match: `${googleNamespace}:*` })) googleKeys.push(...batch); if (googleKeys.length) await redis.del(...googleKeys);
  const holds = await prisma.booking.findMany({ where: { businessId: { in: businessIds } }, select: { id: true } });
  if (holds.length) await redis.del(...holds.map((hold) => `visit:hold:${hold.id}`));
  for (const id of businessIds) { const keys: string[] = []; for await (const batch of redis.scanStream({ match: `visit:reservation:${id}:*` })) keys.push(...batch); if (keys.length) await redis.del(...keys); }
  await prisma.booking.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
  await prisma.identity.deleteMany({ where: { id: { in: identityIds } } });
  await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
}
