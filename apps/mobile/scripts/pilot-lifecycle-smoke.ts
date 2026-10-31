import assert from 'node:assert/strict';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { BrowserSession } from './pilot-customers';
import type { prisma as Prisma } from '../../api/src/db/client.js';
import type { redis as Redis } from '../../api/src/infra/redis.js';
import { translate, type Locale } from '../src/i18n/messages';
import { configureBusinessSmoke, sharingBusinessSmoke, SETUP_SERVICE, SETUP_STAFF_NAME } from './business-setup-smoke';
import { preferBookingTime } from './booking-controls.utils';

// VIS-14 golden path: one provider is onboarded entirely through the UI (only the platform admin is seeded, as the
// UI never grants ADMIN), then customers arrive through that provider's real shared link and book through final consent.
// The pilot accepts only Israeli business time (PILOT_TIMEZONE in the API). Copied rather than imported: loading API
// runtime modules before the harness assigns the test environment would let the API read .env.
const BUSINESS_TIMEZONE = 'Asia/Jerusalem';
const TRAVELER_TIMEZONE = 'America/New_York';
const SERVICE_NAME = SETUP_SERVICE.name;
const STAFF_NAME = SETUP_STAFF_NAME;
const PRICE_MINOR = SETUP_SERVICE.price * 100;
const BOOKABLE_DAYS_AHEAD = 4;
const REVIEW_REASON = 'Verified pilot lifecycle application and ownership evidence.';
const evidence = path.resolve('test-results/vis14');

// What the suites that continue on this business need: its identity, and its provider's and customers' signed-in browsers.
export type PilotBusiness = { businessId: string; businessName: string; serviceId: string; bookableDate: string; slug: string; providerSession: BrowserSession; customers: { locale: Locale; session: BrowserSession; bookingId: string }[] };
type Deps = { browser: Browser; webUrl: string; apiUrl: string; prisma: typeof Prisma; redis: typeof Redis; run: string; identityIds: string[]; businessIds: string[] };

// Offset of a time zone at an instant, from ICU's "GMT+02:00" style name.
function offsetMinutes(instant: number, timeZone: string) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(instant).find(part => part.type === 'timeZoneName')?.value ?? 'GMT';
  const match = name.match(/GMT([+-])(\d{2}):(\d{2})/);
  return match ? (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
}
// The UTC instant of a business-local wall time, computed independently of the app's own scheduling code.
function businessInstant(date: string, time: string) {
  const wall = Date.parse(`${date}T${time}:00Z`);
  let instant = wall;
  for (let pass = 0; pass < 2; pass++) instant = wall - offsetMinutes(instant, BUSINESS_TIMEZONE) * 60000;
  return new Date(instant);
}
// Formats in the browser's own ICU, so expected strings do not drift with the Node version running the test.
function expectedReviewText(page: Page, locale: Locale, instant: Date, priceMinor: number) {
  return page.evaluate(({ locale, instant, timeZone, price, currency }) => ({
    when: new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-US', { dateStyle: 'full', timeStyle: 'short', timeZone }).format(new Date(instant)),
    price: new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(price),
  }), { locale, instant: instant.toISOString(), timeZone: BUSINESS_TIMEZONE, price: priceMinor / 100, currency: SETUP_SERVICE.currency });
}
async function redisKeys(redis: typeof Redis, pattern: string) {
  const keys: string[] = [];
  for await (const batch of redis.scanStream({ match: pattern })) keys.push(...(batch as string[]));
  return keys;
}

export async function pilotLifecycleSmoke({ browser, webUrl, apiUrl, prisma, redis, run, identityIds, businessIds }: Deps): Promise<PilotBusiness> {
  const contexts: BrowserContext[] = [], errors: string[] = [];
  await mkdir(evidence, { recursive: true });
  async function newContext(locale: Locale, timezoneId?: string) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: locale === 'he' ? 'he-IL' : 'en-US', timezoneId });
    contexts.push(context);
    await context.addInitScript(value => localStorage.setItem('visit.locale.v1.guest', value), locale);
    return context;
  }
  async function newPage(context: BrowserContext) { const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); return page; }
  async function signInWithPhone(page: Page, locale: Locale, phone: string) {
    const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
    await page.getByRole('textbox', { name: t('auth.phone'), exact: true }).fill(phone);
    await page.getByRole('button', { name: t('auth.sendCode'), exact: true }).click();
    const codeField = page.getByRole('textbox', { name: t('auth.codeLabel'), exact: true });
    await codeField.waitFor();
    const response = await fetch(`${apiUrl}/__dev/otp?phone=${encodeURIComponent(phone)}`);
    assert.equal(response.status, 200);
    await codeField.fill((await response.json() as { code: string }).code);
    await page.getByRole('button', { name: t('auth.verify'), exact: true }).click();
  }
  async function identityOf(context: BrowserContext) {
    const me = await (await context.request.get(`${apiUrl}/api/auth/me`)).json() as { profile: { id: string } };
    identityIds.push(me.profile.id);
    return me.profile.id;
  }
  const syntheticPhone = () => `+1555${randomInt(1000000, 9999999)}`;

  try {
    return await lifecycle();
  } catch (error) {
    // Keep what every open page showed at the moment of failure before the contexts close.
    let index = 0;
    for (const context of contexts) for (const page of context.pages()) await page.screenshot({ path: path.join(evidence, `failure-${index++}.png`), fullPage: true }).catch(() => undefined);
    throw error;
  } finally { await Promise.all(contexts.map(context => context.close())); }

  async function lifecycle(): Promise<PilotBusiness> {
    // 1. A new identity applies through login's provider path and keeps customer access.
    const en = (key: Parameters<typeof translate>[1]) => translate('en', key);
    const providerContext = await newContext('en'), provider = await newPage(providerContext);
    await provider.goto(`${webUrl}/auth/login`);
    await provider.getByRole('link', { name: en('auth.providerEntry'), exact: true }).click();
    await provider.waitForURL(url => url.pathname === '/register/provider');
    await provider.getByRole('link', { name: en('providerEntry.signIn'), exact: true }).click();
    await provider.waitForURL(url => url.pathname === '/auth/login' && url.searchParams.get('returnTo') === '/register/provider');
    await signInWithPhone(provider, 'en', syntheticPhone());
    await provider.waitForURL(url => url.pathname === '/register/provider');
    const providerId = await identityOf(providerContext);
    const businessName = `Pilot lifecycle ${run.slice(0, 6)}`, slug = `pilot-${run}`;
    await provider.getByRole('textbox', { name: 'Business name', exact: true }).fill(businessName);
    await provider.getByRole('textbox', { name: 'Business URL name', exact: true }).fill(slug);
    const submitted = provider.waitForResponse(r => r.url() === `${apiUrl}/v1/provider-applications` && r.request().method() === 'POST');
    await provider.getByRole('button', { name: 'Submit for approval', exact: true }).click();
    assert.equal((await submitted).status(), 201);
    const business = await prisma.business.findUniqueOrThrow({ where: { slug } }); businessIds.push(business.id);
    await provider.getByText('Pending review', { exact: true }).filter({ visible: true }).waitFor();
    await provider.goto(`${webUrl}/`);
    await provider.getByRole('heading', { name: en('home.title'), exact: true }).waitFor();
    assert.equal(await prisma.membership.count({ where: { businessId: business.id, identityId: providerId, status: 'ACTIVE' } }), 0);
    console.log('PASS: VIS-14 new identity applied from the login provider path, sees pending review and keeps customer Home.');

    // 2. A separate administrator approves with a reason. The UI cannot create admins, so only this identity is seeded.
    const admin = await prisma.identity.create({ data: { email: `pilot-admin-${run}@example.test`, emailVerifiedAt: new Date(), platformRole: 'ADMIN' } }); identityIds.push(admin.id);
    const adminToken = randomBytes(32).toString('base64url');
    await prisma.session.create({ data: { identityId: admin.id, tokenHash: createHash('sha256').update(adminToken).digest('hex'), expiresAt: new Date(Date.now() + 600000) } });
    const adminContext = await newContext('en'); await adminContext.addCookies([{ name: 'visit_session', value: adminToken, url: apiUrl, httpOnly: true, sameSite: 'Lax' }]);
    const adminPage = await newPage(adminContext);
    await adminPage.goto(`${webUrl}/admin/applications`);
    const card = adminPage.getByText(businessName, { exact: true }).locator('..');
    await card.getByRole('textbox', { name: 'Review reason', exact: true }).fill(REVIEW_REASON);
    await card.getByRole('button', { name: 'Approve application', exact: true }).click();
    await adminPage.getByText('Decision recorded. The applicant can see their status.', { exact: true }).filter({ visible: true }).waitFor();
    await provider.goto(`${webUrl}/register/provider`);
    await provider.getByText('Approved — complete business setup before publishing', { exact: true }).filter({ visible: true }).waitFor();
    assert.equal(await prisma.membership.count({ where: { businessId: business.id, identityId: providerId, status: 'ACTIVE' } }), 1);
    const application = await prisma.providerApplication.findFirstOrThrow({ where: { businessId: business.id } });
    assert.equal(application.status, 'APPROVED'); assert.equal(application.reviewReason, REVIEW_REASON);
    console.log('PASS: VIS-14 administrator approved with a recorded reason; the applicant gains business membership.');

    // 3. Setup through the UI, including a required verified customer phone; unpublished links stay unbookable.
    const setup = await configureBusinessSmoke({ page: provider, context: providerContext, webUrl, apiUrl, businessId: business.id });
    await provider.getByTestId('setup-section-policy').click();
    await provider.getByRole('switch', { name: 'Require verified phone', exact: true }).click();
    const policySaved = provider.waitForResponse(r => r.url() === `${apiUrl}/v1/provider/businesses/${business.id}/booking-policy` && r.request().method() === 'PUT');
    await provider.getByRole('button', { name: 'Save booking policy', exact: true }).click();
    assert.equal((await policySaved).status(), 200);
    assert.equal((await prisma.bookingPolicy.findUniqueOrThrow({ where: { businessId: business.id } })).requireVerifiedPhone, true);
    assert.equal((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).timezone, BUSINESS_TIMEZONE);
    const bookableDate = new Date(Date.now() + BOOKABLE_DAYS_AHEAD * 86400000).toISOString().slice(0, 10);
    const bookability = {
      link: `${apiUrl}/api/provider-links/${slug}`,
      detail: `${apiUrl}/api/providers/${business.id}`,
      availability: `${apiUrl}/api/providers/${business.id}/availability?serviceId=${setup.serviceId}&date=${bookableDate}`,
      calendar: `${apiUrl}/api/providers/${business.id}/booking-calendar?serviceId=${setup.serviceId}&fromDate=${bookableDate}&days=7`,
    };
    // The same requests answer 200 after publishing (below), so these 404s come from publication, not a bad request.
    for (const url of Object.values(bookability)) assert.equal((await fetch(url)).status, 404, url);

    // 4. Publish, then take the link from the real Copy button and the decoded QR code.
    await provider.getByRole('button', { name: 'Publish business', exact: true }).click();
    await provider.getByText('Published — ready for bookings', { exact: true }).filter({ visible: true }).waitFor();
    await sharingBusinessSmoke({ page: provider, context: providerContext, webUrl, apiUrl, businessId: business.id, slug });
    const sharedLink = `${webUrl}/p/${slug}`;
    for (const url of Object.values(bookability)) assert.equal((await fetch(url)).status, 200, url);
    const opened = await (await fetch(bookability.availability)).json() as { slots: { available: boolean }[] };
    assert.ok(opened.slots.some(slot => slot.available));
    console.log('PASS: VIS-14 provider set up Asia/Jerusalem business with required verified phone; link denied until publish, then shared by copy and QR.');

    // 5–7. Customers open that link anonymously, sign in, save once, review without any hold and confirm once.
    async function customerJourney(locale: Locale, time: string) {
      const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
      const context = await newContext(locale, TRAVELER_TIMEZONE), page = await newPage(context);
      let saves = 0; page.on('request', request => { if (request.url() === `${apiUrl}/api/me/providers` && request.method() === 'POST') saves++; });
      await page.goto(sharedLink);
      await page.getByRole('link', { name: t('providers.signIn'), exact: true }).click();
      await page.waitForURL(url => url.pathname === '/auth/login' && url.searchParams.get('returnTo') === `/p/${slug}`);
      const phone = syntheticPhone();
      await signInWithPhone(page, locale, phone);
      await page.waitForURL(url => url.pathname === `/booking/${business.id}`);
      const customerId = await identityOf(context);
      await page.getByRole('heading', { name: t('compact.title'), exact: true }).filter({ visible: true }).waitFor();
      assert.equal(await page.locator('html').getAttribute('dir'), locale === 'he' ? 'rtl' : 'ltr');
      assert.equal(await prisma.savedProvider.count({ where: { identityId: customerId, businessId: business.id } }), 1);
      assert.equal(saves, 1);
      assert.equal(await prisma.membership.count({ where: { identityId: customerId } }), 0);
      // The only service is selected for the customer; phone sign-in already satisfies the verified-phone requirement.
      await page.getByRole('button', { name: new RegExp(`${t('compact.chooseService')} · ${SERVICE_NAME}`) }).filter({ visible: true }).waitFor();
      await page.getByText(t('bookingContact.ready'), { exact: true }).filter({ visible: true }).waitFor();
      // Calendar: the staff closure is disabled, then the bookable date is chosen.
      await page.getByTestId('booking-date-trigger').filter({ visible: true }).click();
      for (const target of [setup.closedDate, bookableDate]) {
        for (let step = 0; step < 3; step++) {
          const month = await page.getByTestId('booking-calendar-month').getAttribute('aria-label');
          if (month === target.slice(0, 7)) break;
          await page.getByRole('button', { name: t(month && month < target.slice(0, 7) ? 'compact.nextMonth' : 'compact.previousMonth'), exact: true }).click();
        }
        if (target === setup.closedDate) assert.equal(await page.getByTestId(`booking-day-${target}`).isDisabled(), true);
      }
      await page.getByTestId(`booking-day-${bookableDate}`).click();
      await page.getByRole('dialog', { name: t('compact.chooseDate'), exact: true }).waitFor({ state: 'hidden' });
      await preferBookingTime(page, time);
      const confirmedBefore = await prisma.booking.count({ where: { businessId: business.id, status: 'CONFIRMED' } });
      await page.getByRole('button', { name: new RegExp(`${time} · ${STAFF_NAME}`) }).filter({ visible: true }).first().click();
      // Review shows the exact business-local time even though this browser runs in New York.
      const expected = businessInstant(bookableDate, time);
      const shown = await expectedReviewText(page, locale, expected, PRICE_MINOR);
      // The review card is the parent of its business/service line; the price also appears under the service picker.
      const reviewCard = page.getByText(`${businessName} · ${SERVICE_NAME}`, { exact: true }).filter({ visible: true }).locator('..');
      await reviewCard.waitFor();
      await reviewCard.getByText(`${shown.when} · ${STAFF_NAME}`, { exact: true }).waitFor();
      await reviewCard.getByText(`${SETUP_SERVICE.durationMinutes} ${t('bookingCommit.minutes')} · ${shown.price}`, { exact: true }).waitFor();
      await page.getByText(`${businessName} · ${SERVICE_NAME}`, { exact: true }).filter({ visible: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(evidence, `review-${locale}-mobile.png`), fullPage: true });
      // No capacity hold and no booking exist while the customer is only selecting and reviewing.
      assert.equal(await prisma.booking.count({ where: { businessId: business.id, status: { not: 'CONFIRMED' } } }), 0);
      assert.equal(await prisma.booking.count({ where: { businessId: business.id, status: 'CONFIRMED' } }), confirmedBefore);
      assert.deepEqual(await redisKeys(redis, `visit:reservation:${business.id}:*`), []);
      assert.deepEqual(await redisKeys(redis, `visit:slot:${encodeURIComponent(business.id)}:*`), []);
      let commits = 0; page.on('request', request => { if (request.url().endsWith('/api/bookings/commit')) commits++; });
      await page.getByRole('button', { name: t('compact.confirm'), exact: true }).filter({ visible: true }).click();
      await page.locator('[data-testid="booking-confirmation"]:visible').waitFor();
      await page.screenshot({ path: path.join(evidence, `confirmation-${locale}-mobile.png`), fullPage: true });
      const confirmed = await prisma.booking.findMany({ where: { businessId: business.id, customerId, status: 'CONFIRMED' } });
      assert.equal(confirmed.length, 1); assert.equal(commits, 1);
      const booking = confirmed[0]!;
      assert.equal(booking.startsAt.toISOString(), expected.toISOString());
      assert.equal(booking.serviceId, setup.serviceId); assert.equal(booking.staffId, setup.staffId);
      assert.equal(booking.customerPhone, phone); assert.ok(booking.customerPhoneVerifiedAt);
      assert.equal(booking.servicePriceMinor, PRICE_MINOR); assert.equal(booking.serviceCurrency, SETUP_SERVICE.currency);
      assert.equal(saves, 1);
      // Customer Home leads with the new upcoming appointment.
      await page.goto(`${webUrl}/`);
      await page.getByRole('heading', { name: t('home.title'), exact: true }).filter({ visible: true }).waitFor();
      await page.getByTestId(`active-booking-${booking.id}`).waitFor();
      await page.screenshot({ path: path.join(evidence, `home-${locale}-mobile.png`), fullPage: true });
      console.log(`PASS: VIS-14 ${locale} customer opened the shared link, signed in, saved once, reviewed ${time} Israel time with no hold, confirmed once and sees it on Home.`);
      return { booking, phone, session: await context.storageState() };
    }
    const english = await customerJourney('en', '10:00');
    const hebrew = await customerJourney('he', '11:00');

    // 8. The provider's agenda shows both committed appointments with service and verified contact.
    await provider.goto(`${webUrl}/provider/dashboard?businessId=${business.id}`);
    await provider.getByLabel('Agenda date', { exact: true }).fill(bookableDate);
    for (const { booking, phone } of [english, hebrew]) {
      const agendaCard = provider.getByTestId(`agenda-booking-${booking.id}`);
      await agendaCard.waitFor();
      const text = await agendaCard.innerText();
      assert.ok(text.includes(SERVICE_NAME), `agenda card lacks service: ${text}`);
      assert.ok(text.includes(phone), `agenda card lacks customer phone: ${text}`);
    }
    // The day's summary carries the revenue of both committed appointments.
    const appointmentsTile = provider.getByText(en('dashboard.appointments'), { exact: true }).locator('..');
    assert.equal((await appointmentsTile.innerText()).replace(en('dashboard.appointments'), '').trim(), '2');
    const revenue = await provider.evaluate(({ total, currency }) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(total), { total: 2 * PRICE_MINOR / 100, currency: SETUP_SERVICE.currency });
    const revenueTile = provider.getByText(en('dashboard.revenue'), { exact: true }).locator('..');
    assert.equal((await revenueTile.innerText()).replace(en('dashboard.revenue'), '').trim(), revenue);
    await provider.getByTestId(`agenda-booking-${english.booking.id}`).scrollIntoViewIfNeeded();
    await provider.screenshot({ path: path.join(evidence, 'agenda-en-mobile.png'), fullPage: true });
    assert.equal(await prisma.booking.count({ where: { businessId: business.id, status: 'CONFIRMED' } }), 2);
    assert.deepEqual(errors, []);
    console.log('PASS: VIS-14 provider agenda shows both committed bookings with service, verified customer contact and expected revenue.');
    const customers = [{ locale: 'en' as const, ...english }, { locale: 'he' as const, ...hebrew }].map(({ locale, booking, session }) => ({ locale, session, bookingId: booking.id }));
    return { businessId: business.id, businessName, serviceId: setup.serviceId, bookableDate, slug, providerSession: await providerContext.storageState(), customers };
  }
}
