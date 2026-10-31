import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { prisma as Prisma } from '../../api/src/db/client.js';
import type { redis as Redis } from '../../api/src/infra/redis.js';
import { translate, type Locale } from '../src/i18n/messages';
import { SETUP_SERVICE, SETUP_STAFF_NAME } from './business-setup-smoke';
import { preferBookingTime } from './booking-controls.utils';
import type { PilotBusiness } from './pilot-lifecycle-smoke';

// Customers, slots and review steps on the business the VIS-14 lifecycle smoke onboarded through the UI, shared by the
// suites that continue on it. Each suite owns the contexts it opens (contexts) and the page errors it saw (errors).
export const COMMIT_PATH = '/api/bookings/commit';
export type Slot = { startsAt: string; localTime: string; staffId: string; available: boolean; locked: boolean; remainingCapacity: number };
export type PilotCustomer = Awaited<ReturnType<ReturnType<typeof pilotCustomers>['customer']>>;
export type BrowserSession = Awaited<ReturnType<BrowserContext['storageState']>>;
type Deps = { browser: Browser; webUrl: string; apiUrl: string; prisma: typeof Prisma; redis: typeof Redis; identityIds: string[]; business: PilotBusiness; resetSignInLimits: () => Promise<unknown> };

export function pilotCustomers({ browser, webUrl, apiUrl, prisma, redis, identityIds, business, resetSignInLimits }: Deps) {
  const contexts: BrowserContext[] = [], errors: string[] = [];
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
  // A returning user on the device an earlier suite signed in: its saved browser state, not a second sign-in (a new
  // code for the same phone within minutes is refused by the per-phone cooldown).
  async function resume(locale: Locale, session: BrowserSession) {
    const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: locale === 'he' ? 'he-IL' : 'en-US', storageState: session });
    contexts.push(context);
    await context.addInitScript(value => localStorage.setItem('visit.locale.v1.guest', value), locale);
    const page = await newPage(context);
    await page.goto(webUrl);
    await page.getByRole('heading', { name: t('home.title'), exact: true }).filter({ visible: true }).waitFor();
    const me = await (await context.request.get(`${apiUrl}/api/auth/me`)).json() as { profile: { id: string } };
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
  // "Leaves nothing behind": no live hold or extra confirmed booking, and no Redis hold record or capacity member that
  // is not a confirmed booking. Capacity members are read from Redis itself, so an entry without a database row fails too.
  async function assertNothingHeld(customerId: string, confirmed: number) {
    assert.equal(await prisma.booking.count({ where: { businessId: business.businessId, customerId, status: 'HELD' } }), 0);
    assert.equal(await prisma.booking.count({ where: { businessId: business.businessId, customerId, status: 'CONFIRMED' } }), confirmed);
    const committed = new Set((await prisma.booking.findMany({ where: { businessId: business.businessId, status: 'CONFIRMED' }, select: { id: true } })).map(booking => booking.id));
    const capacityKeys: string[] = [];
    for await (const batch of redis.scanStream({ match: `visit:reservation:${business.businessId}:*` })) capacityKeys.push(...(batch as string[]));
    for (const key of capacityKeys) for (const member of await redis.zrange(key, 0, -1)) assert.ok(committed.has(member), `capacity member ${member} in ${key} is not a confirmed booking`);
    for (const { id } of await prisma.booking.findMany({ where: { businessId: business.businessId, customerId, status: { not: 'CONFIRMED' } }, select: { id: true } })) {
      assert.equal(await redis.exists(`visit:hold:${id}`), 0, `hold record remains for ${id}`);
    }
  }
  return { contexts, errors, bookingUrl, newContext, newPage, customer, resume, freeSlots, slotButton, reviewCard, confirmButton, review, bookThroughApi, fillSlot, assertNothingHeld };
}
