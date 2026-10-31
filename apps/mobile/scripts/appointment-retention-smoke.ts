import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { Browser, Page } from 'playwright';
import type { prisma as Prisma } from '../../api/src/db/client.js';
import type { redis as Redis } from '../../api/src/infra/redis.js';
import { translate } from '../src/i18n/messages';
import { SETUP_SERVICE } from './business-setup-smoke';
import { preferBookingTime } from './booking-controls.utils';
import { CANCELLATION_CUTOFF, RESCHEDULE_CUTOFF } from '../src/lib/AppointmentLifecycle.utils';
import { pilotCustomers, type PilotCustomer, type Slot } from './pilot-customers';
import type { PilotBusiness } from './pilot-lifecycle-smoke';

// VIS-14 slice (b): reschedule/cancel, saved-list isolation and unpublish on the business the lifecycle smoke onboarded
// through the UI, continuing in its provider's and customers' signed-in browsers. Hold expiry on unpublish is proven by
// apps/api/test/publication.test.ts, not here: in the app a hold exists only inside a commit (decisions.md).
// Error codes are the API's response contract (AppError codes), not tuning values.
const evidence = path.resolve('test-results/vis14');
const PRICE_MINOR = SETUP_SERVICE.price * 100;
// Scenario dates are at most this many days after the lifecycle's booking date.
const SCENARIO_DAYS = 25;
// B5's cutoff: longer than any appointment in this suite is from now (asserted there), so each is inside the window.
const CUTOFF_MINUTES = 60 * 24 * 60;
// The agenda's revenue tile for a day without revenue (ProviderAgenda.component.tsx).
const NO_REVENUE = '—';

type Deps = { browser: Browser; webUrl: string; apiUrl: string; prisma: typeof Prisma; redis: typeof Redis; identityIds: string[]; business: PilotBusiness; resetSignInLimits: () => Promise<unknown> };
type ApiFailure = { error: { code: string } };

export async function appointmentRetentionSmoke(deps: Deps) {
  const { webUrl, apiUrl, prisma, business } = deps;
  const { contexts, errors, capacityKeysOf, newPage, resume, freeSlots, slotButton, reviewCard, confirmButton, review, bookThroughApi, fillSlot, assertNothingHeld } = pilotCustomers(deps);
  await mkdir(evidence, { recursive: true });
  const pilot = (locale: 'en' | 'he') => business.customers.find(entry => entry.locale === locale)!;
  const booking = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id } });
  const homeCard = (page: Page, id: string) => page.getByTestId(`active-booking-${id}`).filter({ visible: true });
  const savedCard = (page: Page) => page.getByTestId(`saved-provider-${business.businessId}`).filter({ visible: true });
  const alert = (page: Page, text: string) => page.getByRole('alert').filter({ visible: true, hasText: text });
  const used = new Set<string>();
  // A date on which this business has no booking at all, so earlier suites' bookings and buffers shape none of its slots.
  async function freshDate() {
    for (let offset = 1; offset <= SCENARIO_DAYS; offset++) {
      const date = new Date(Date.parse(`${business.bookableDate}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
      const day = { gte: new Date(Date.parse(`${date}T00:00:00Z`) - 86400000), lt: new Date(Date.parse(`${date}T00:00:00Z`) + 2 * 86400000) };
      if (used.has(date) || await prisma.booking.count({ where: { businessId: business.businessId, startsAt: day } })) continue;
      used.add(date); return date;
    }
    throw new Error('no free date left within the booking horizon');
  }
  // Slots offered to an existing appointment's owner: the private endpoint, which also answers while unpublished.
  async function rescheduleSlots(owner: PilotCustomer, bookingId: string, date: string) {
    const response = await owner.context.request.get(`${apiUrl}/api/bookings/${bookingId}/availability?serviceId=${business.serviceId}&date=${date}`);
    assert.equal(response.status(), 200, await response.text());
    return ((await response.json()) as { slots: Slot[] }).slots.filter(slot => slot.available && !slot.locked);
  }
  // From Home's card to a reviewed new time; the date comes from the URL because the calendar labels are per locale.
  async function reviewReschedule(owner: PilotCustomer, page: Page, bookingId: string, date: string, slot: Slot) {
    await page.goto(webUrl);
    await homeCard(page, bookingId).getByRole('button', { name: owner.t('details.reschedule'), exact: true }).click();
    await page.waitForURL(url => url.pathname === `/booking/${business.businessId}` && url.searchParams.get('fromBookingId') === bookingId);
    const url = new URL(page.url()); url.searchParams.set('date', date); await page.goto(url.href);
    await page.getByRole('heading', { name: owner.t('compact.title'), exact: true }).filter({ visible: true }).waitFor();
    await preferBookingTime(page, slot.localTime);
    await slotButton(page, slot).first().click();
    await reviewCard(page).waitFor();
  }
  const rescheduleButton = (owner: PilotCustomer, page: Page) => page.getByRole('button', { name: owner.t('compact.reschedule'), exact: true }).filter({ visible: true });
  const rescheduleResponse = (page: Page, bookingId: string) => page.waitForResponse(response => response.url() === `${apiUrl}/v1/bookings/${bookingId}/reschedule` && response.request().method() === 'POST');
  const cancelResponse = (page: Page, bookingId: string) => page.waitForResponse(response => response.url() === `${apiUrl}/v1/bookings/${bookingId}/cancel` && response.request().method() === 'POST');
  async function rescheduleFromHome(owner: PilotCustomer, bookingId: string, date: string, slot: Slot) {
    await reviewReschedule(owner, owner.page, bookingId, date, slot);
    const moved = rescheduleResponse(owner.page, bookingId);
    await rescheduleButton(owner, owner.page).click();
    assert.equal((await moved).status(), 200);
    await owner.page.getByRole('heading', { name: owner.t('details.success'), exact: true }).filter({ visible: true }).waitFor();
    const row = await booking(bookingId);
    assert.equal(row.status, 'CONFIRMED'); assert.equal(row.startsAt.toISOString(), slot.startsAt);
    assert.equal(await prisma.booking.count({ where: { businessId: business.businessId, customerId: owner.id, status: 'CONFIRMED' } }), 1);
    return row;
  }
  // window.confirm on web; the app cancels only after the customer accepts it.
  async function cancelWith(page: Page, button: ReturnType<Page['getByRole']>, bookingId: string) {
    page.once('dialog', dialog => void dialog.accept());
    const reply = cancelResponse(page, bookingId);
    await button.click();
    return reply;
  }
  // The provider's agenda for one date: which appointments it lists and the day's count and revenue tiles.
  async function agenda(provider: Page, date: string) {
    await provider.goto(`${webUrl}/provider/dashboard?businessId=${business.businessId}`);
    await provider.getByLabel(translate('en', 'dashboard.date'), { exact: true }).fill(date);
    // A summary tile's value, waited for: the agenda for the new date loads after the date changes.
    async function tile(key: 'dashboard.appointments' | 'dashboard.revenue', expected: string) {
      const label = translate('en', key), box = provider.getByText(label, { exact: true }).locator('..');
      await box.filter({ hasText: expected }).waitFor();
      assert.equal((await box.innerText()).replace(label, '').trim(), expected);
    }
    return { has: (id: string) => provider.getByTestId(`agenda-booking-${id}`), tile };
  }
  const money = (page: Page, minor: number) => page.evaluate(({ total, currency }) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(total), { total: minor / 100, currency: SETUP_SERVICE.currency });
  async function publication(provider: Page, action: 'publish.stop' | 'publish.action', status: 'publish.draft' | 'publish.live') {
    await provider.goto(`${webUrl}/provider/${business.businessId}`);
    await provider.getByRole('button', { name: translate('en', action), exact: true }).click();
    await provider.getByText(translate('en', status), { exact: true }).filter({ visible: true }).waitFor();
  }
  async function errorCode(response: { json(): Promise<unknown> }) { return ((await response.json()) as ApiFailure).error.code; }

  try {
    const provider = await resume('en', business.providerSession);
    const en = await resume('en', pilot('en').session), he = await resume('he', pilot('he').session);
    const e1 = pilot('en').bookingId, h1 = pilot('he').bookingId;
    // The resumed browsers are the identities that booked.
    assert.equal((await booking(e1)).customerId, en.id); assert.equal((await booking(h1)).customerId, he.id);

    // B1a. The English customer reschedules from Home; Home, details and the agenda follow the move.
    const firstMoveDate = await freshDate(), firstMove = (await rescheduleSlots(en, e1, firstMoveDate))[0]!;
    const before = await booking(e1);
    const moved = await rescheduleFromHome(en, e1, firstMoveDate, firstMove);
    assert.equal(moved.revision, before.revision + 1);
    await en.page.goto(webUrl);
    assert.ok((await homeCard(en.page, e1).innerText()).includes(firstMove.localTime));
    await en.page.goto(`${webUrl}/appointment/${e1}`);
    await en.page.getByText(new RegExp(firstMove.localTime)).filter({ visible: true }).first().waitFor();
    const newDay = await agenda(provider.page, firstMoveDate);
    await newDay.has(e1).waitFor();
    assert.ok((await newDay.has(e1).innerText()).includes(firstMove.localTime), 'agenda row lacks the new time');
    const oldDay = await agenda(provider.page, business.bookableDate);
    await oldDay.has(e1).waitFor({ state: 'hidden' });
    console.log('PASS: VIS-14 customer rescheduled from Home; Home, details and the provider agenda show the new Israel time on one confirmed row.');

    // B1b. Rescheduling into a time other customers take during review is refused in the customer's language; the
    // original appointment, its revision and its Redis capacity stay as they were.
    for (const [owner, id, locale] of [[en, e1, 'en'], [he, h1, 'he']] as const) {
      const contestedDate = await freshDate(), contested = (await rescheduleSlots(owner, id, contestedDate))[0]!;
      const was = await booking(id), wasHeld = await capacityKeysOf(id);
      assert.ok(wasHeld.length > 0, `${id} holds no Redis capacity before the attempt`);
      let snapshot: string | undefined, frozen = false;
      await owner.page.route(url => url.href.startsWith(`${apiUrl}/api/bookings/${id}/availability?`), async route => {
        if (frozen && snapshot) { await route.fulfill({ status: 200, contentType: 'application/json', body: snapshot }); return; }
        const response = await route.fetch(); snapshot = await response.text(); await route.fulfill({ response, body: snapshot });
      });
      await reviewReschedule(owner, owner.page, id, contestedDate, contested);
      frozen = true;
      await fillSlot(locale, contestedDate, contested);
      const refusedMove = rescheduleResponse(owner.page, id);
      await rescheduleButton(owner, owner.page).click();
      const refusal = await refusedMove; assert.equal(refusal.status(), 409); assert.equal(await errorCode(refusal), 'CONFLICT');
      await alert(owner.page, owner.t('bookingCommit.conflict')).waitFor();
      await owner.page.screenshot({ path: path.join(evidence, `reschedule-conflict-${locale}-mobile.png`), fullPage: true });
      await owner.page.unrouteAll({ behavior: 'wait' });
      const kept = await booking(id);
      assert.equal(kept.startsAt.toISOString(), was.startsAt.toISOString()); assert.equal(kept.revision, was.revision); assert.equal(kept.status, 'CONFIRMED');
      assert.deepEqual(await capacityKeysOf(id), wasHeld);
      await assertNothingHeld(owner.id, 1);
      // Home still shows the original time.
      await owner.page.goto(webUrl);
      const card = await homeCard(owner.page, id).innerText();
      assert.ok(card.includes(await owner.page.evaluate(instant => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Jerusalem' }).format(new Date(instant)), was.startsAt.toISOString())), `Home lost the original time: ${card}`);
    }
    console.log('PASS: VIS-14 rescheduling into a time taken during review is refused with the localized conflict in Hebrew and English; the original appointment is unchanged in the UI, the database and Redis.');

    // B1c. The Hebrew customer cancels from the appointment details; the agenda drops it and its revenue, and the audit
    // records the customer as the actor.
    const cancelDate = await freshDate(), cancelSlot = (await freeSlots(cancelDate))[0]!;
    const second = await bookThroughApi(he.context, cancelSlot); assert.equal(second.status(), 200);
    const h2 = ((await second.json()) as { id: string }).id;
    const beforeCancel = await agenda(provider.page, cancelDate);
    await beforeCancel.has(h2).waitFor();
    await beforeCancel.tile('dashboard.revenue', await money(provider.page, PRICE_MINOR));
    // Home shows the next appointment (h1) and counts the later h2 as one more.
    const oneMore = translate('he', 'upcoming.more', { count: 1 });
    await he.page.goto(webUrl);
    await homeCard(he.page, h1).getByRole('button', { name: oneMore, exact: true }).waitFor();
    await he.page.goto(`${webUrl}/appointment/${h2}`);
    const cancelled = await cancelWith(he.page, he.page.getByRole('button', { name: he.t('details.cancel'), exact: true }).filter({ visible: true }), h2);
    assert.equal(cancelled.status(), 200);
    assert.equal((await booking(h2)).status, 'CANCELLED');
    const audit = await prisma.bookingEvent.findFirstOrThrow({ where: { bookingId: h2, newStatus: 'CANCELLED' } });
    assert.equal(audit.actorIdentityId, he.id); assert.equal(audit.source, 'CUSTOMER');
    const afterCancel = await agenda(provider.page, cancelDate);
    await afterCancel.has(h2).waitFor({ state: 'hidden' });
    await afterCancel.tile('dashboard.appointments', '0'); await afterCancel.tile('dashboard.revenue', NO_REVENUE);
    await he.page.getByRole('button', { name: he.t('details.cancel'), exact: true }).filter({ visible: true }).waitFor({ state: 'hidden' });
    await he.page.goto(webUrl);
    await homeCard(he.page, h1).waitFor();
    assert.equal(await homeCard(he.page, h1).getByRole('button', { name: oneMore, exact: true }).count(), 0);
    console.log('PASS: VIS-14 Hebrew customer cancelled from details; the agenda drops it and its revenue, and the audit names the customer.');

    // B2. Each customer sees only their own providers and appointments; removing the provider keeps the appointment.
    await en.page.goto(webUrl);
    await homeCard(en.page, e1).waitFor(); await savedCard(en.page).waitFor();
    assert.equal(await homeCard(en.page, h1).count(), 0);
    assert.equal(await homeCard(he.page, e1).count(), 0);
    assert.equal((await en.context.request.get(`${apiUrl}/v1/bookings/${h1}/details`)).status(), 404);
    assert.equal((await he.context.request.get(`${apiUrl}/v1/bookings/${e1}/details`)).status(), 404);
    await savedCard(en.page).getByRole('button', { name: en.t('home.remove'), exact: true }).click();
    await en.page.getByText(en.t('home.empty'), { exact: true }).filter({ visible: true }).waitFor();
    await savedCard(en.page).waitFor({ state: 'hidden' });
    const retained = homeCard(en.page, e1);
    await retained.getByRole('button', { name: en.t('details.reschedule'), exact: true }).waitFor();
    await retained.getByRole('button', { name: en.t('details.cancel'), exact: true }).waitFor();
    assert.equal(await prisma.savedProvider.count({ where: { identityId: en.id, businessId: business.businessId } }), 0);
    assert.equal(await prisma.savedProvider.count({ where: { identityId: he.id, businessId: business.businessId } }), 1);
    await he.page.reload(); await savedCard(he.page).waitFor();
    await en.page.screenshot({ path: path.join(evidence, 'removed-provider-keeps-appointment-en-mobile.png'), fullPage: true });
    console.log('PASS: VIS-14 saved lists and appointments stay per customer; removing the provider keeps the appointment manageable and leaves the other customer\'s save.');

    // B3. The provider unpublishes while both customers are reviewing a new booking: confirm is refused in each
    // customer's language and nothing is written.
    const reviewDate = await freshDate(), reviewSlot = (await freeSlots(reviewDate))[0]!;
    const enReview = await newPage(en.context), heReview = await newPage(he.context);
    await review(enReview, en.t, reviewDate, reviewSlot); await review(heReview, he.t, reviewDate, reviewSlot);
    await publication(provider.page, 'publish.stop', 'publish.draft');
    for (const [page, shopper] of [[enReview, en], [heReview, he]] as const) {
      const reply = page.waitForResponse(response => response.url() === `${apiUrl}/api/bookings/commit` && response.request().method() === 'POST');
      await confirmButton(page, shopper.t).click();
      // An unpublished business is not public: the commit answers as for any business that cannot be booked.
      const response = await reply; assert.equal(response.status(), 404); assert.equal(await errorCode(response), 'NOT_FOUND');
      await alert(page, shopper.t('bookingCommit.conflict')).waitFor();
      await page.screenshot({ path: path.join(evidence, `unpublished-during-review-${shopper === en ? 'en' : 'he'}-mobile.png`), fullPage: true });
    }
    await assertNothingHeld(en.id, 1); await assertNothingHeld(he.id, 1);
    // No attempt is left pending, so nothing could later commit or block a retry.
    assert.equal(await prisma.bookingAttempt.count({ where: { businessId: business.businessId, customerId: { in: [en.id, he.id] }, status: 'PENDING' } }), 0);
    assert.equal(await prisma.booking.count({ where: { businessId: business.businessId, startsAt: new Date(reviewSlot.startsAt) } }), 0);

    // While unpublished, the saved entry shows only its saved name and cannot book; existing appointments stay.
    await he.page.goto(webUrl);
    const unavailable = savedCard(he.page);
    await unavailable.getByText(he.t('home.providerUnavailable'), { exact: true }).waitFor();
    await unavailable.getByText(business.businessName, { exact: true }).waitFor();
    assert.equal(await unavailable.getByRole('button', { name: he.t('home.notAccepting'), exact: true }).isDisabled(), true);
    const heCard = homeCard(he.page, h1);
    await heCard.getByRole('button', { name: he.t('details.reschedule'), exact: true }).waitFor();
    await heCard.scrollIntoViewIfNeeded();
    await he.page.screenshot({ path: path.join(evidence, 'unpublished-saved-entry-he-mobile.png'), fullPage: true });
    await heCard.getByRole('button', { name: he.t('details.open'), exact: true }).click();
    await he.page.waitForURL(`${webUrl}/appointment/${h1}`);
    await he.page.getByRole('heading', { name: he.t('details.title'), exact: true }).filter({ visible: true }).waitFor();
    await he.page.getByText(SETUP_SERVICE.name, { exact: true }).filter({ visible: true }).first().waitFor();
    await he.page.goto(webUrl);
    const heCancelled = await cancelWith(he.page, homeCard(he.page, h1).getByRole('button', { name: he.t('details.cancel'), exact: true }), h1);
    assert.equal(heCancelled.status(), 200); assert.equal((await booking(h1)).status, 'CANCELLED');
    // Rescheduling an existing appointment needs business approval, not publication.
    const unpublishedDate = await freshDate(), unpublishedMove = (await rescheduleSlots(en, e1, unpublishedDate))[0]!;
    const movedWhileUnpublished = await rescheduleFromHome(en, e1, unpublishedDate, unpublishedMove);
    await en.page.goto(webUrl); await homeCard(en.page, e1).waitFor();
    await en.page.screenshot({ path: path.join(evidence, 'unpublished-retained-appointment-en-mobile.png'), fullPage: true });
    // New bookings stay refused: the shared link in the UI and at the API, and the commit endpoint itself.
    await he.page.goto(`${webUrl}/p/${business.slug}`);
    await he.page.getByText(he.t('providers.unavailable'), { exact: true }).filter({ visible: true }).waitFor();
    assert.equal((await fetch(`${apiUrl}/api/provider-links/${business.slug}`)).status, 404);
    assert.equal((await bookThroughApi(he.context, reviewSlot)).status(), 404);
    assert.equal(await prisma.booking.count({ where: { businessId: business.businessId, startsAt: new Date(reviewSlot.startsAt) } }), 0);
    console.log(`PASS: VIS-14 unpublish during review refuses confirm in Hebrew and English with nothing written; saved entries show unavailable, existing appointments open, cancel and reschedule, and new bookings stay refused.`);

    // B4. Republishing makes the saved entry bookable again; the customer refused during review books exactly once.
    await publication(provider.page, 'publish.action', 'publish.live');
    await he.page.goto(webUrl);
    await savedCard(he.page).getByRole('button', { name: he.t('home.book'), exact: true }).click();
    await he.page.waitForURL(url => url.pathname === `/booking/${business.businessId}`);
    await review(he.page, he.t, reviewDate, reviewSlot);
    await confirmButton(he.page, he.t).click();
    await he.page.locator('[data-testid="booking-confirmation"]:visible').waitFor();
    const rebooked = await prisma.booking.findMany({ where: { businessId: business.businessId, customerId: he.id, status: 'CONFIRMED' } });
    assert.equal(rebooked.length, 1); assert.equal(rebooked[0]!.startsAt.toISOString(), reviewSlot.startsAt);
    const h4 = rebooked[0]!.id;
    const unchanged = await booking(e1);
    assert.equal(unchanged.startsAt.toISOString(), movedWhileUnpublished.startsAt.toISOString()); assert.equal(unchanged.revision, movedWhileUnpublished.revision);
    console.log('PASS: VIS-14 republish makes the saved entry bookable; the customer refused during review books once and existing appointments are unchanged.');

    // B5. Inside the cutoff window. Pages opened before the provider saves the cutoff still offer the actions, so the
    // server's refusal reaches the customer: it must say why, in their language. After a reload the actions are gone.
    const raced: { owner: PilotCustomer; id: string; locale: 'en' | 'he'; home: Page; move: Page }[] = [];
    for (const [owner, id, locale] of [[en, e1, 'en'], [he, h4, 'he']] as const) {
      const home = await newPage(owner.context), move = await newPage(owner.context);
      await home.goto(webUrl); await homeCard(home, id).getByRole('button', { name: owner.t('details.cancel'), exact: true }).waitFor();
      const date = await freshDate(), slot = (await rescheduleSlots(owner, id, date))[0]!;
      await reviewReschedule(owner, move, id, date, slot);
      raced.push({ owner, id, locale, home, move });
    }
    const rows = new Map(await Promise.all(raced.map(async ({ id }) => [id, { row: await booking(id), held: await capacityKeysOf(id) }] as const)));
    for (const { row } of rows.values()) assert.ok(+row.startsAt < Date.now() + CUTOFF_MINUTES * 60000, 'an appointment is outside the cutoff window');
    const details = new Map<string, Page>();
    for (const { owner, id } of raced) {
      const page = await newPage(owner.context); details.set(id, page);
      await page.goto(`${webUrl}/appointment/${id}`); await page.getByRole('button', { name: owner.t('details.cancel'), exact: true }).filter({ visible: true }).waitFor();
    }
    await provider.page.goto(`${webUrl}/provider/${business.businessId}`);
    await provider.page.getByTestId('setup-section-policy').click();
    await provider.page.getByRole('textbox', { name: translate('en', 'setup.cancelCutoff'), exact: true }).fill(String(CUTOFF_MINUTES));
    await provider.page.getByRole('textbox', { name: translate('en', 'setup.rescheduleCutoff'), exact: true }).fill(String(CUTOFF_MINUTES));
    const policySaved = provider.page.waitForResponse(response => response.url() === `${apiUrl}/v1/provider/businesses/${business.businessId}/booking-policy` && response.request().method() === 'PUT');
    await provider.page.getByRole('button', { name: translate('en', 'setup.savePolicy'), exact: true }).click();
    assert.equal((await policySaved).status(), 200);
    for (const { owner, id, locale, home, move } of raced) {
      const cancelRefused = await cancelWith(home, homeCard(home, id).getByRole('button', { name: owner.t('details.cancel'), exact: true }), id);
      assert.equal(cancelRefused.status(), 409); assert.equal(await errorCode(cancelRefused), CANCELLATION_CUTOFF);
      await alert(home, owner.t('lifecycle.cancelCutoff')).waitFor();
      await home.screenshot({ path: path.join(evidence, `cutoff-cancel-refused-${locale}-mobile.png`), fullPage: true });
      const detailsPage = details.get(id)!;
      const detailsRefused = await cancelWith(detailsPage, detailsPage.getByRole('button', { name: owner.t('details.cancel'), exact: true }).filter({ visible: true }), id);
      assert.equal(detailsRefused.status(), 409); assert.equal(await errorCode(detailsRefused), CANCELLATION_CUTOFF);
      await alert(detailsPage, owner.t('lifecycle.cancelCutoff')).waitFor();
      const moveRefused = rescheduleResponse(move, id);
      await rescheduleButton(owner, move).click();
      const moveReply = await moveRefused; assert.equal(moveReply.status(), 409); assert.equal(await errorCode(moveReply), RESCHEDULE_CUTOFF);
      await alert(move, owner.t('lifecycle.rescheduleCutoff')).waitFor();
      await move.screenshot({ path: path.join(evidence, `cutoff-reschedule-refused-${locale}-mobile.png`), fullPage: true });
      // A fresh Home no longer offers either action inside the window.
      await home.reload(); await homeCard(home, id).waitFor();
      for (const label of [owner.t('details.cancel'), owner.t('details.reschedule')]) assert.equal(await homeCard(home, id).getByRole('button', { name: label, exact: true }).count(), 0);
      const row = await booking(id), was = rows.get(id)!;
      assert.equal(row.status, 'CONFIRMED'); assert.equal(row.startsAt.toISOString(), was.row.startsAt.toISOString()); assert.equal(row.revision, was.row.revision);
      assert.deepEqual(await capacityKeysOf(id), was.held);
      await assertNothingHeld(owner.id, 1);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: VIS-14 inside the cutoff, cancel (Home and details) and reschedule are refused with their own localized reason in Hebrew and English, the appointment is unchanged, and a fresh Home no longer offers them.');
  } catch (error) {
    let index = 0;
    for (const context of contexts) for (const page of context.pages()) await page.screenshot({ path: path.join(evidence, `retention-failure-${index++}.png`), fullPage: true }).catch(() => undefined);
    throw error;
  } finally { await Promise.all(contexts.map(context => context.close())); }
}
