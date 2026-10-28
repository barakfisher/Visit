import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, BrowserContext, Page, Response } from 'playwright';
import type { prisma as Prisma } from '../../api/src/db/client.js';
import type { redis as Redis } from '../../api/src/infra/redis.js';
import { translate, type Locale } from '../src/i18n/messages';
import { SETUP_SERVICE, SETUP_STAFF_NAME } from './business-setup-smoke';
import { preferBookingTime } from './booking-controls.utils';
import type { PilotBusiness } from './pilot-lifecycle-smoke';

// VIS-14: conflict, stale slot, outage and duplicate/lost responses on the business the lifecycle smoke onboarded
// through the UI. Each scenario books on its own date, so no scenario's bookings or buffers shape another's slots.
// Error codes are the API's response contract (AppError codes), not tuning values.
const COMMIT_PATH = '/api/bookings/commit';
const evidence = path.resolve('test-results/vis14');

type Deps = { browser: Browser; webUrl: string; apiUrl: string; prisma: typeof Prisma; redis: typeof Redis; identityIds: string[]; business: PilotBusiness; resetSignInLimits: () => Promise<unknown> };
type Slot = { startsAt: string; localTime: string; staffId: string; available: boolean; locked: boolean; remainingCapacity: number };
type ApiFailure = { error: { code: string } };

export async function bookingResilienceSmoke({ browser, webUrl, apiUrl, prisma, redis, identityIds, business, resetSignInLimits }: Deps) {
  const contexts: BrowserContext[] = [], errors: string[] = [];
  await mkdir(evidence, { recursive: true });
  let dateOffset = 0;
  // Dates after the lifecycle's own booking date and its closed staff date.
  const scenarioDate = () => new Date(Date.parse(`${business.bookableDate}T12:00:00Z`) + ++dateOffset * 86400000).toISOString().slice(0, 10);
  const bookingUrl = (date: string) => `${webUrl}/booking/${business.businessId}?serviceId=${business.serviceId}&date=${date}`;
  const availabilityUrl = (date: string) => `${apiUrl}/api/providers/${business.businessId}/availability?serviceId=${business.serviceId}&date=${date}`;

  async function newContext(locale: Locale) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: locale === 'he' ? 'he-IL' : 'en-US' });
    contexts.push(context);
    await context.addInitScript(value => localStorage.setItem('visit.locale.v1.guest', value), locale);
    return context;
  }
  async function newPage(context: BrowserContext) { const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message)); return page; }
  // A fresh customer signs in with a synthetic phone, which satisfies the business's verified-phone requirement.
  async function customer(locale: Locale) {
    const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
    await resetSignInLimits();
    const context = await newContext(locale), page = await newPage(context), phone = `+1555${randomInt(1000000, 9999999)}`;
    await page.goto(`${webUrl}/auth/login`);
    await page.getByRole('textbox', { name: t('auth.phone'), exact: true }).fill(phone);
    await page.getByRole('button', { name: t('auth.sendCode'), exact: true }).click();
    const codeField = page.getByRole('textbox', { name: t('auth.codeLabel'), exact: true });
    await codeField.waitFor();
    const otp = await fetch(`${apiUrl}/__dev/otp?phone=${encodeURIComponent(phone)}`); assert.equal(otp.status, 200);
    await codeField.fill((await otp.json() as { code: string }).code);
    await page.getByRole('button', { name: t('auth.verify'), exact: true }).click();
    await page.getByRole('heading', { name: t('home.title'), exact: true }).filter({ visible: true }).waitFor();
    const me = await (await context.request.get(`${apiUrl}/api/auth/me`)).json() as { profile: { id: string } };
    identityIds.push(me.profile.id);
    return { context, page, id: me.profile.id, t };
  }
  async function freeSlots(date: string) {
    const response = await fetch(availabilityUrl(date)); assert.equal(response.status, 200);
    return ((await response.json()) as { slots: Slot[] }).slots.filter(slot => slot.available && !slot.locked);
  }
  const slotButton = (page: Page, slot: Slot) => page.getByRole('button', { name: new RegExp(`^${slot.localTime} · ${SETUP_STAFF_NAME}`) }).filter({ visible: true });
  const reviewCard = (page: Page) => page.getByText(`${business.businessName} · ${SETUP_SERVICE.name}`, { exact: true }).filter({ visible: true });
  const confirmButton = (page: Page, t: (key: 'compact.confirm') => string) => page.getByRole('button', { name: t('compact.confirm'), exact: true }).filter({ visible: true });
  // Opens the booking screen on a date and reviews one slot. Review is advisory: nothing is written yet.
  async function review(page: Page, t: (key: Parameters<typeof translate>[1]) => string, date: string, slot: Slot) {
    await page.goto(bookingUrl(date));
    await page.getByRole('heading', { name: t('compact.title'), exact: true }).filter({ visible: true }).waitFor();
    await page.getByText(t('bookingContact.ready'), { exact: true }).filter({ visible: true }).waitFor();
    await preferBookingTime(page, slot.localTime);
    await slotButton(page, slot).first().click();
    await reviewCard(page).waitFor();
  }
  // A second, real customer takes a slot through the same final-consent endpoint the app uses.
  async function bookThroughApi(context: BrowserContext, slot: Slot, idempotencyKey = randomUUID()) {
    return context.request.post(`${apiUrl}${COMMIT_PATH}`, { headers: { Origin: webUrl }, data: commitBody(slot, idempotencyKey) });
  }
  function commitBody(slot: Slot, idempotencyKey: string) {
    return { finalConsent: true, reviewedService: { name: SETUP_SERVICE.name, durationMinutes: SETUP_SERVICE.durationMinutes, priceMinor: SETUP_SERVICE.price * 100, currency: SETUP_SERVICE.currency }, providerId: business.businessId, serviceId: business.serviceId, staffId: slot.staffId, startsAt: slot.startsAt, idempotencyKey };
  }
  // The lifecycle staff member takes several appointments at once, so a slot goes stale only when other real
  // customers take every remaining place. Each rival is a separate customer, so this does not depend on whether one
  // customer may hold overlapping bookings (an open product decision).
  async function fillSlot(locale: Locale, date: string, slot: Slot) {
    assert.ok(slot.remainingCapacity >= 1);
    for (let place = 0; place < slot.remainingCapacity; place++) {
      const rival = await customer(locale);
      const taken = await bookThroughApi(rival.context, slot); assert.equal(taken.status(), 200);
    }
    assert.ok(!(await freeSlots(date)).some(free => free.startsAt === slot.startsAt));
  }
  // "Leaves nothing behind": no live hold or extra confirmed booking, and no Redis hold record or capacity member.
  async function assertNothingHeld(customerId: string, confirmed: number) {
    assert.equal(await prisma.booking.count({ where: { businessId: business.businessId, customerId, status: 'HELD' } }), 0);
    assert.equal(await prisma.booking.count({ where: { businessId: business.businessId, customerId, status: 'CONFIRMED' } }), confirmed);
    const own = await prisma.booking.findMany({ where: { businessId: business.businessId, customerId, status: { not: 'CONFIRMED' } }, select: { id: true } });
    const capacityKeys: string[] = [];
    for await (const batch of redis.scanStream({ match: `visit:reservation:${business.businessId}:*` })) capacityKeys.push(...(batch as string[]));
    for (const { id } of own) {
      assert.equal(await redis.exists(`visit:hold:${id}`), 0, `hold record remains for ${id}`);
      for (const key of capacityKeys) assert.equal(await redis.zscore(key, id), null, `capacity member remains for ${id} in ${key}`);
    }
  }
  const commitResponse = (page: Page) => page.waitForResponse(response => response.url() === `${apiUrl}${COMMIT_PATH}` && response.request().method() === 'POST');
  async function errorCode(response: Response) { return ((await response.json()) as ApiFailure).error.code; }
  async function expectConfirmation(page: Page, customerId: string, slot: Slot) {
    await page.locator('[data-testid="booking-confirmation"]:visible').waitFor();
    const booked = await prisma.booking.findMany({ where: { businessId: business.businessId, customerId, status: 'CONFIRMED', startsAt: new Date(slot.startsAt) } });
    assert.equal(booked.length, 1);
    return booked[0]!;
  }
  // D: after losing, the same customer books another free time and gets exactly one booking for it.
  async function bookAnotherTime(page: Page, t: (key: Parameters<typeof translate>[1]) => string, customerId: string, date: string, lost: Slot) {
    const next = (await freeSlots(date)).find(slot => slot.startsAt !== lost.startsAt);
    assert.ok(next, 'no other free slot to recover with');
    await review(page, t, date, next);
    await confirmButton(page, t).click();
    await expectConfirmation(page, customerId, next);
    await assertNothingHeld(customerId, 1);
  }

  try {
    await staleDuringReview();
    await staleConfirm();
    await realOutage();
    await neverReachedServer();
    await doubleActivation();
    await duplicatedDelivery();
    await sameCustomerTwoTabs();
    assert.deepEqual(errors, []);
  } catch (error) {
    let index = 0;
    for (const context of contexts) for (const page of context.pages()) await page.screenshot({ path: path.join(evidence, `resilience-failure-${index++}.png`), fullPage: true }).catch(() => undefined);
    throw error;
  } finally { await Promise.all(contexts.map(context => context.close())); }

  // A1. The slot is taken while the customer reviews; the background availability refresh clears the review.
  async function staleDuringReview() {
    const date = scenarioDate(), slot = (await freeSlots(date))[0]!;
    const shopper = await customer('en');
    await review(shopper.page, shopper.t, date, slot);
    await fillSlot('en', date, slot);
    // Waits on the message, not on the refresh interval (a tuning value).
    await shopper.page.getByText(shopper.t('compact.changed'), { exact: true }).filter({ visible: true }).waitFor();
    await reviewCard(shopper.page).waitFor({ state: 'hidden' });
    await slotButton(shopper.page, slot).waitFor({ state: 'hidden' });
    await shopper.page.screenshot({ path: path.join(evidence, 'stale-review-en-mobile.png'), fullPage: true });
    await assertNothingHeld(shopper.id, 0);
    assert.equal(await prisma.bookingAttempt.count({ where: { businessId: business.businessId, customerId: shopper.id } }), 0);
    console.log('PASS: VIS-14 a slot taken during review is cleared by the availability refresh; the customer returns to selection with nothing held.');
  }

  // A2 + D. Refreshes are held back, so the customer confirms a stale review; the server refuses, the app returns to
  // selection with the slot excluded, and the customer then books another time.
  async function staleConfirm() {
    const date = scenarioDate(), slot = (await freeSlots(date))[0]!;
    const shopper = await customer('he');
    let snapshot: string | undefined, frozen = false;
    await shopper.page.route(url => url.href.startsWith(`${apiUrl}/api/providers/${business.businessId}/availability?`), async route => {
      if (frozen && snapshot) { await route.fulfill({ status: 200, contentType: 'application/json', body: snapshot }); return; }
      const response = await route.fetch(); snapshot = await response.text(); await route.fulfill({ response, body: snapshot });
    });
    await review(shopper.page, shopper.t, date, slot);
    frozen = true;
    await fillSlot('he', date, slot);
    const refused = commitResponse(shopper.page);
    await confirmButton(shopper.page, shopper.t).click();
    const response = await refused; assert.equal(response.status(), 409); assert.equal(await errorCode(response), 'CONFLICT');
    // The customer reads the refusal in their own language (VIS-14 acceptance), not the server's diagnostic text.
    await shopper.page.getByRole('alert').filter({ visible: true, hasText: shopper.t('bookingCommit.conflict') }).waitFor();
    await reviewCard(shopper.page).waitFor({ state: 'hidden' });
    // The stale snapshot still lists the slot as available; the app must exclude it anyway.
    await slotButton(shopper.page, slot).waitFor({ state: 'hidden' });
    await shopper.page.screenshot({ path: path.join(evidence, 'stale-confirm-he-mobile.png'), fullPage: true });
    await assertNothingHeld(shopper.id, 0);
    await shopper.page.unrouteAll({ behavior: 'wait' });
    await bookAnotherTime(shopper.page, shopper.t, shopper.id, date, slot);
    console.log('PASS: VIS-14 confirming a stale review is refused with a conflict, the slot is excluded, nothing is held, and the customer books another time.');
  }

  // B1. The test API's own Redis client is closed: the server answers 503, the attempt is kept, and the retry after
  // reconnecting commits exactly once with the same idempotency key.
  async function realOutage() {
    const date = scenarioDate(), slot = (await freeSlots(date))[0]!;
    const shopper = await customer('en');
    await review(shopper.page, shopper.t, date, slot);
    const keys: string[] = [];
    shopper.page.on('request', request => { if (request.url() === `${apiUrl}${COMMIT_PATH}`) keys.push(request.postDataJSON().idempotencyKey); });
    try {
      redis.disconnect();
      const failed = commitResponse(shopper.page);
      await confirmButton(shopper.page, shopper.t).click();
      const response = await failed; assert.equal(response.status(), 503); assert.equal(await errorCode(response), 'LOCK_UNAVAILABLE');
      await shopper.page.getByText(shopper.t('bookingCommit.uncertain'), { exact: true }).filter({ visible: true }).waitFor();
      assert.equal(await prisma.booking.count({ where: { businessId: business.businessId, customerId: shopper.id } }), 0);
      await shopper.page.screenshot({ path: path.join(evidence, 'outage-uncertain-en-mobile.png'), fullPage: true });
    } finally { await redis.connect(); }
    await shopper.page.getByRole('button', { name: shopper.t('bookingCommit.retry'), exact: true }).filter({ visible: true }).click();
    await expectConfirmation(shopper.page, shopper.id, slot);
    await shopper.page.screenshot({ path: path.join(evidence, 'outage-retried-en-mobile.png'), fullPage: true });
    assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]);
    await assertNothingHeld(shopper.id, 1);
    console.log('PASS: VIS-14 a real reservation outage returns 503, keeps the attempt uncertain with nothing saved, and the same-key retry commits once.');
  }

  // B2. The request fails in the browser before reaching the server; the server never sees it, and the retry with the
  // same key commits exactly once.
  async function neverReachedServer() {
    const date = scenarioDate(), slot = (await freeSlots(date))[0]!;
    const shopper = await customer('he');
    await review(shopper.page, shopper.t, date, slot);
    const keys: string[] = [];
    await shopper.page.route(`${apiUrl}${COMMIT_PATH}`, async route => {
      keys.push(route.request().postDataJSON().idempotencyKey);
      if (keys.length === 1) await route.abort('failed'); else await route.continue();
    });
    await confirmButton(shopper.page, shopper.t).click();
    await shopper.page.getByText(shopper.t('bookingCommit.uncertain'), { exact: true }).filter({ visible: true }).waitFor();
    assert.equal(await prisma.booking.count({ where: { businessId: business.businessId, customerId: shopper.id } }), 0);
    assert.equal(await prisma.bookingAttempt.count({ where: { businessId: business.businessId, idempotencyKey: keys[0]! } }), 0);
    await shopper.page.screenshot({ path: path.join(evidence, 'lost-request-uncertain-he-mobile.png'), fullPage: true });
    await shopper.page.getByRole('button', { name: shopper.t('bookingCommit.retry'), exact: true }).filter({ visible: true }).click();
    const booked = await expectConfirmation(shopper.page, shopper.id, slot);
    assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]); assert.equal(booked.idempotencyKey, keys[0]);
    await shopper.page.unrouteAll({ behavior: 'wait' });
    await assertNothingHeld(shopper.id, 1);
    console.log('PASS: VIS-14 a request lost before the server leaves nothing saved; the same-key retry commits once.');
  }

  // C1. Two activations of Confirm in the same turn send one request and make one booking.
  async function doubleActivation() {
    const date = scenarioDate(), slot = (await freeSlots(date))[0]!;
    const shopper = await customer('en');
    await review(shopper.page, shopper.t, date, slot);
    let commits = 0; shopper.page.on('request', request => { if (request.url() === `${apiUrl}${COMMIT_PATH}`) commits++; });
    await confirmButton(shopper.page, shopper.t).evaluate(button => { (button as HTMLElement).click(); (button as HTMLElement).click(); });
    await expectConfirmation(shopper.page, shopper.id, slot);
    assert.equal(commits, 1);
    await assertNothingHeld(shopper.id, 1);
    console.log('PASS: VIS-14 a same-turn double activation of Confirm sends one request and creates one booking.');
  }

  // C2. The identical request reaches the server twice at once (as a retrying proxy would); one booking results.
  async function duplicatedDelivery() {
    const date = scenarioDate(), slot = (await freeSlots(date))[0]!;
    const shopper = await customer('he');
    await review(shopper.page, shopper.t, date, slot);
    let statuses: { status: number; code?: string; id?: string }[] = [];
    await shopper.page.route(`${apiUrl}${COMMIT_PATH}`, async route => {
      const [first, second] = await Promise.all([route.fetch(), route.fetch()]);
      statuses = await Promise.all([first, second].map(async response => {
        const body = await response.json() as { id?: string } & Partial<ApiFailure>;
        return { status: response.status(), code: body.error?.code, id: body.id };
      }));
      await route.fulfill({ response: first.status() === 200 ? first : second });
    });
    await confirmButton(shopper.page, shopper.t).click();
    const booked = await expectConfirmation(shopper.page, shopper.id, slot);
    assert.ok(statuses.some(result => result.status === 200), JSON.stringify(statuses));
    // The other copy either returns the same booking or is told the same attempt is still processing.
    for (const result of statuses) {
      if (result.status === 200) assert.equal(result.id, booked.id);
      else { assert.equal(result.status, 409); assert.equal(result.code, 'ATTEMPT_PENDING'); }
    }
    assert.equal(await prisma.booking.count({ where: { businessId: business.businessId, idempotencyKey: booked.idempotencyKey } }), 1);
    await shopper.page.unrouteAll({ behavior: 'wait' });
    await assertNothingHeld(shopper.id, 1);
    console.log(`PASS: VIS-14 the same request delivered twice at once creates one booking (${statuses.map(result => result.code ?? result.status).join(', ')}).`);
  }

  // C3. One customer has the same time under review in two tabs and confirms in one, then the other. Each tab is its
  // own logical attempt (its own key), so idempotency does not join them, and while places remain both commit: the
  // customer holds two bookings at the same time. Recorded finding, not an endorsed rule; whether one customer may
  // hold overlapping bookings is an open decision (docs/architecture/decisions.md). Change this expectation with it.
  // Confirms are sequential on purpose: truly simultaneous ones race the short per-slot Redis lock, so their outcome
  // depends on timing.
  async function sameCustomerTwoTabs() {
    const date = scenarioDate(), slot = (await freeSlots(date))[0]!;
    assert.ok(slot.remainingCapacity >= 2, 'C3 needs a slot with room for both tabs');
    const shopper = await customer('en'), second = await newPage(shopper.context), tabs = [shopper.page, second];
    for (const tab of tabs) await review(tab, shopper.t, date, slot);
    const keys: string[] = [];
    for (const tab of tabs) {
      tab.on('request', request => { if (request.url() === `${apiUrl}${COMMIT_PATH}`) keys.push(request.postDataJSON().idempotencyKey); });
      const reply = commitResponse(tab);
      await confirmButton(tab, shopper.t).click();
      assert.equal((await reply).status(), 200);
      await tab.locator('[data-testid="booking-confirmation"]:visible').waitFor();
    }
    assert.equal(new Set(keys).size, tabs.length);
    assert.equal(await prisma.booking.count({ where: { businessId: business.businessId, customerId: shopper.id, status: 'CONFIRMED', startsAt: new Date(slot.startsAt) } }), tabs.length);
    await second.screenshot({ path: path.join(evidence, 'two-tabs-both-confirmed-en-mobile.png'), fullPage: true });
    await assertNothingHeld(shopper.id, tabs.length);
    console.log('PASS: VIS-14 (recorded finding) one customer confirming the same time from two tabs gets two overlapping bookings while places remain; no hold is left behind.');
  }
}
