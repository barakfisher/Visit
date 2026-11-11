import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Browser } from 'playwright';
import type { prisma as Prisma } from '../../api/src/db/client.js';
import { dateRange, localDate } from '../src/lib/appointmentTime';
import { showAgendaAt, unfoldAgendaCard } from './agenda-day';
import { selectBookingDate, showBookingTime } from './booking-controls.utils';
export async function manualBookingSmoke({ browser, webUrl, apiUrl, prisma, run, businessIds, identityIds }: { browser: Browser; webUrl: string; apiUrl: string; prisma: typeof Prisma; run: string; businessIds: string[]; identityIds: string[] }) {
 const business = await prisma.business.create({ data: { name: 'Telephone appointments — תורים טלפוניים', slug: `manual-web-${run}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } }); businessIds.push(business.id);
 const owner = await prisma.identity.create({ data: { email: `manual-web-${run}@example.test`, preferredLocale: 'en' } }); identityIds.push(owner.id);
 await prisma.membership.create({ data: { businessId: business.id, identityId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
 const service = await prisma.service.create({ data: { businessId: business.id, name: 'Phone consultation', durationMinutes: 30, priceMinor: 10000, currency: 'ILS' } }), staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Phone specialist' } });
 await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
 await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 60, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0, bufferBeforeMinutes: 5, bufferAfterMinutes: 5, requireVerifiedPhone: true, requireVerifiedEmail: true, requireCustomerName: true } });
 await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '00:00', endLocal: '23:59' })) });
 const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), token = randomUUID();
 await prisma.session.create({ data: { identityId: owner.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 900000) } });
 const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles' });
 let release: (() => void) | undefined;
 let routeFailure: unknown;
 try {
  await context.addCookies([{ name: 'visit_session', value: token, url: apiUrl, httpOnly: true, sameSite: 'Lax' }]); await context.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en'));
  const page = await context.newPage(), home = `${webUrl}/provider/dashboard?businessId=${business.id}`; await page.goto(home);
  const summary = page.getByTestId('agenda-summary'); await summary.waitFor();
  const optionsUrl = `${apiUrl}/v1/provider/businesses/${business.id}/manual-booking-options`, saveUrl = `${apiUrl}/v1/provider/businesses/${business.id}/manual-bookings`;
  await page.route(optionsUrl, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE"}}' }));
  const footer = page.getByTestId('app-footer'), addTab = footer.getByRole('button', { name: 'Add appointment', exact: true });
  // Add appointment rises from the bottom over the home, like Block time (decisions.md, 2026-11-11).
  await addTab.click(); const sheet = page.getByTestId('manual-booking-sheet'), form = sheet.getByTestId('manual-booking-form');
  await form.getByText('Appointment options could not load.', { exact: true }).waitFor();
  assert.equal(await summary.count(), 1); assert.equal(new URL(page.url()).pathname, '/provider/dashboard');
  await page.unroute(optionsUrl); await form.getByRole('button', { name: 'Try again', exact: true }).click();
  // Nothing is typed but the customer: no date, time, UTC offset or exception reason fields.
  await form.getByRole('button', { name: /Choose a service/ }).waitFor(); assert.equal(await form.getByRole('textbox').count(), 3);
  // A new form starts today in the business's timezone; this appointment is for a later day.
  assert.match(await form.getByTestId('booking-date-trigger').getAttribute('aria-label') ?? '', new RegExp(`${localDate(business.timezone)}$`));
  const chooseService = async () => { await form.getByRole('button', { name: /Choose a service/ }).click(); await page.getByRole('dialog', { name: 'Choose a service', exact: true }).getByRole('button', { name: /Phone consultation/ }).click(); };
  const chooseTime = async (time: string) => { await showBookingTime(page, time); await form.getByRole('button', { name: new RegExp(`^${time}`) }).click(); await form.getByTestId('manual-chosen-time').filter({ hasText: time }).waitFor(); };
  await chooseService(); await selectBookingDate(page, date);
  await form.getByLabel('Customer name', { exact: true }).fill('לקוחה חדשה — ללא חשבון'); await form.getByLabel('Customer phone', { exact: true }).fill('050-1234567');
  // Without a time the review refuses and writes nothing.
  await form.getByRole('button', { name: 'Continue', exact: true }).click(); await form.getByRole('alert').waitFor();
  assert.equal(await prisma.booking.count({ where: { businessId: business.id } }), 0);
  // The business requires verified contact, and still no reason is asked for (decisions.md, 2026-11-11).
  await chooseTime('10:00');
  await form.getByRole('button', { name: 'Continue', exact: true }).click(); await form.getByRole('button', { name: 'Confirm manual appointment', exact: true }).waitFor();
  assert.equal(await prisma.booking.count({ where: { businessId: business.id } }), 0);
  // Lose the response after the real server commits; retry must recover this exact attempt.
  let posts = 0, key = '';
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(saveUrl, async route => { posts++; key = route.request().postDataJSON().idempotencyKey; await gate; try { const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('failed'); } catch (error) { routeFailure = error; await route.abort('failed').catch(() => {}); } });
  await form.getByRole('button', { name: 'Confirm manual appointment', exact: true }).click();
  await form.locator('[aria-busy="true"]').waitFor();
  assert.equal(await form.getByRole('button', { name: 'Confirm manual appointment', exact: true }).isDisabled(), true); release?.();
  await form.getByText(/We could not confirm that the appointment was saved/).waitFor();
  // Edit is not offered while the outcome is unknown; Close stays available (checked below, after the retry).
  assert.equal(await form.getByRole('button', { name: 'Edit appointment details', exact: true }).count(), 0); assert.equal(await form.getByRole('button', { name: 'Close', exact: true }).isDisabled(), false); assert.equal(posts, 1); assert.equal(routeFailure, undefined);
  assert.equal(await prisma.booking.count({ where: { businessId: business.id } }), 1);
  await page.unroute(saveUrl);
  const retry = page.waitForRequest(request => request.url() === saveUrl && request.method() === 'POST');
  await form.getByRole('button', { name: 'Try again', exact: true }).click(); assert.equal((await retry).postDataJSON().idempotencyKey, key);
  await form.getByText('Appointment saved. Contact details remain unverified; no automatic message was sent.', { exact: true }).waitFor();
  const saved = await prisma.booking.findFirstOrThrow({ where: { businessId: business.id } });
  assert.equal(saved.customerId, null); assert.equal(saved.customerPhoneVerifiedAt, null); assert.equal(saved.customerEmailVerifiedAt, null); assert.equal(saved.manualReason, null);
  // The phone was typed the local way and stored in E.164.
  assert.equal(saved.customerPhone, '+972501234567');
  assert.equal(await prisma.bookingNotification.count({ where: { businessId: business.id } }), 0);
  assert.equal(await prisma.identity.count({ where: { phone: '+972501234567' } }), 0);
  assert.equal((await prisma.bookingEvent.findFirstOrThrow({ where: { bookingId: saved.id } })).source, 'MANUAL');
  // Close lowers the sheet onto today's home, which says which day the appointment was saved for; it is not today, so no card.
  await form.getByRole('button', { name: 'Close', exact: true }).click(); await sheet.waitFor({ state: 'detached' });
  await page.getByTestId('agenda-notice').filter({ hasText: `Appointment saved for ${dateRange(date, date, 'en')}.` }).waitFor();
  const card = page.getByTestId(`agenda-booking-${saved.id}`); assert.equal(await card.count(), 0);
  // Add appointment after a save starts an empty form, with no trace of the last customer or message.
  await addTab.click(); await form.getByRole('button', { name: 'Continue', exact: true }).waitFor();
  assert.equal(await form.getByLabel('Customer name', { exact: true }).inputValue(), ''); assert.equal(await form.getByRole('alert').count() + await form.getByRole('status').count(), 0);
  // The booked time is no longer offered; a time that becomes blocked between review and confirmation is refused and the details stay.
  await chooseService(); await selectBookingDate(page, date); await chooseTime('11:00');
  assert.equal(await form.getByRole('button', { name: /^10:00/ }).count(), 0);
  await form.getByLabel('Customer name', { exact: true }).fill('Another caller'); await form.getByLabel('Customer phone', { exact: true }).fill('+972501234568');
  await form.getByRole('button', { name: 'Continue', exact: true }).click(); await form.getByRole('button', { name: 'Confirm manual appointment', exact: true }).waitFor();
  const blockedDay = new Date(`${date}T00:00:00+02:00`);
  await prisma.timeBlock.create({ data: { businessId: business.id, startsAt: blockedDay, endsAt: new Date(+blockedDay + 86400000), reason: 'Smoke conflict' } });
  await form.getByRole('button', { name: 'Confirm manual appointment', exact: true }).click(); await form.getByRole('alert').filter({ hasText: 'The appointment could not be saved.' }).waitFor();
  assert.equal(await form.getByLabel('Customer name', { exact: true }).inputValue(), 'Another caller'); assert.equal(await prisma.booking.count({ where: { businessId: business.id } }), 1);
  await prisma.timeBlock.deleteMany({ where: { businessId: business.id } });
  await form.getByRole('button', { name: 'Close', exact: true }).click(); await sheet.waitFor({ state: 'detached' });
  // On its own day the manual appointment's card carries the manual tag; the notice is gone once the home was left.
  await showAgendaAt(page, home, `${date}T05:00:00Z`); await unfoldAgendaCard(page, card); await card.getByText(/Manually entered · contact unverified/).waitFor();
  assert.equal(await page.getByTestId('agenda-notice').count(), 0);
  await page.goto(`${webUrl}/account`); const preference = page.waitForResponse(response => response.url() === `${apiUrl}/api/account/preferences` && response.request().method() === 'PUT'); await page.getByTestId('language-he').click(); assert.equal((await preference).status(), 200);
  await page.goto(`${webUrl}/provider/dashboard?businessId=${business.id}`); await page.getByRole('button', { name: 'הוספת תור', exact: true }).click(); await form.getByRole('button', { name: /בחירת שירות/ }).waitFor();
  await form.getByLabel('שם הלקוח', { exact: true }).fill('לקוח חדש עם שם ארוך לצורך בדיקת תצוגה בעברית'); await form.getByLabel('טלפון הלקוח', { exact: true }).fill('050-1234567');
  assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'test-results/manual-booking-he-mobile.png', fullPage: true }); await page.setViewportSize({ width: 1280, height: 900 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: 'test-results/manual-booking-he-desktop.png', fullPage: true });
  console.log('PASS: manual guest appointment as a sheet with service, calendar and free-time picking, no exception reason under a verified-contact policy, local phone stored in E.164, pending guard, committed lost-response recovery without duplicate/identity/notification, capacity conflict with retained details, and Hebrew RTL mobile/desktop.');
 } finally { release?.(); await context.close(); }
}
