import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Browser } from 'playwright';
import type { prisma as Prisma } from '../../api/src/db/client.js';
import { selectBookingDate, preferBookingTime } from './booking-controls.utils';
export async function upcomingAppointmentsSmoke({ browser, webUrl, apiUrl, prisma, run, businessIds, identityIds }: { browser: Browser; webUrl: string; apiUrl: string; prisma: typeof Prisma; run: string; businessIds: string[]; identityIds: string[] }) {
  const business = await prisma.business.create({ data: { name: 'Upcoming studio with a long accessible business name — סטודיו לפגישות ייעוץ ושירות אישי', slug: `upcoming-${run}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } }); businessIds.push(business.id);
  const customer = await prisma.identity.create({ data: { email: `upcoming-${run}@example.test`, preferredLocale: 'en' } }), foreign = await prisma.identity.create({ data: { email: `upcoming-foreign-${run}@example.test` } }); identityIds.push(customer.id, foreign.id);
  await prisma.membership.create({ data: { businessId: business.id, identityId: customer.id, role: 'OWNER', status: 'ACTIVE' } });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Long consultation appointment with comprehensive personal service', durationMinutes: 30 } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Upcoming expert', parallelCapacity: 2 } });
  await prisma.staffService.create({ data: { businessId: business.id, serviceId: service.id, staffId: staff.id } });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '00:00', endLocal: '23:59' })) });
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const bookings = [];
  for (const [index, hour] of [8, 8, 9, 6].entries()) {
    const startsAt = new Date(`${date}T0${hour}:00:00Z`), endsAt = new Date(+startsAt + 1800000);
    bookings.push(await prisma.booking.create({ data: { businessId: business.id, customerId: index === 3 ? foreign.id : customer.id, serviceId: service.id, staffId: staff.id, startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, status: 'CONFIRMED', idempotencyKey: randomUUID() } }));
  }
  const owned = bookings.slice(0, 3).sort((a, b) => +a.startsAt - +b.startsAt || a.id.localeCompare(b.id));
  const [first, second, third] = owned; assert.ok(first && second && third);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Los_Angeles' });
  let releaseLoading: (() => void) | undefined, releaseCancel: (() => void) | undefined;
  try {
    const token = randomUUID(); await prisma.session.create({ data: { identityId: customer.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600000) } });
    await context.addCookies([{ name: 'visit_session', value: token, url: apiUrl, httpOnly: true, sameSite: 'Lax' }]);
    await context.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en'));
    const page = await context.newPage(), upcomingUrl = `${apiUrl}/v1/me/bookings/upcoming`;
    const loadingGate = new Promise<void>(resolve => { releaseLoading = resolve; });
    let gated = true, failRead = false;
    await page.route(upcomingUrl, async route => {
      if (gated) await loadingGate;
      if (failRead) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE"}}' });
      else await route.continue();
    });
    await page.goto(webUrl);
    await page.getByText('Loading your next appointment…', { exact: true }).waitFor();
    await page.getByText("You haven't added any providers yet", { exact: true }).waitFor();
    assert.equal(await page.locator('[data-testid^="active-booking-"]').count(), 0);
    gated = false; releaseLoading?.();
    const firstCard = page.getByTestId(`active-booking-${first.id}`); await firstCard.waitFor();
    const top = await firstCard.boundingBox(), providers = await page.getByRole('heading', { name: 'My Providers', exact: true }).boundingBox(); assert.ok(top && providers && top.y < providers.y);
    assert.equal(await firstCard.getByText('Times are in local Israeli time, even when your device is abroad.', { exact: true }).count(), 1);
    await firstCard.getByRole('button', { name: '2 more upcoming · View all appointments', exact: true }).click();
    // An upcoming appointment is listed once, with the upcoming cards, and not again under history.
    await page.getByTestId(`active-booking-${third.id}`).filter({ visible: true }).getByRole('link', { name: 'View appointment details', exact: true }).waitFor();
    assert.equal(await page.getByTestId(`history-booking-${third.id}`).count(), 0);
    await page.goto(webUrl); await firstCard.waitFor();
    failRead = true; await page.reload();
    await page.getByRole('alert').filter({ hasText: 'Your upcoming appointment could not load.' }).waitFor();
    assert.equal(await page.locator('[data-testid^="active-booking-"]').count(), 0);
    failRead = false; await page.getByRole('button', { name: 'Reload appointments', exact: true }).click(); await firstCard.waitFor();
    await firstCard.getByRole('button', { name: 'View appointment details', exact: true }).click(); await page.waitForURL(`${webUrl}/appointment/${first.id}`);
    await page.goBack(); await firstCard.waitFor();
    await firstCard.getByRole('button', { name: 'Reschedule appointment', exact: true }).click();
    await page.waitForURL(url => url.pathname === `/booking/${business.id}` && url.searchParams.get('fromBookingId') === first.id);
    await selectBookingDate(page, date); await preferBookingTime(page, '12:00');
    await page.getByRole('button', { name: /12:00 · Upcoming expert/ }).click();
    await page.getByRole('button', { name: 'Confirm reschedule', exact: true }).click(); await page.getByRole('heading', { name: 'Appointment rescheduled', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back to Visit', exact: true }).click();
    const secondCard = page.getByTestId(`active-booking-${second.id}`); await secondCard.waitFor();
    await page.goto(`${webUrl}/booking/${business.id}`);
    const contextual = page.getByTestId(`active-booking-${second.id}`); await contextual.getByRole('heading', { name: 'Your appointment with this business', exact: true }).waitFor();
    await page.goto(webUrl); await secondCard.waitFor();
    page.once('dialog', dialog => dialog.dismiss()); await secondCard.getByRole('button', { name: 'Cancel appointment', exact: true }).click();
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: second.id } })).status, 'CONFIRMED');
    const cancelUrl = `${apiUrl}/v1/bookings/${second.id}/cancel`;
    await page.route(cancelUrl, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE"}}' }));
    page.once('dialog', dialog => dialog.accept()); await secondCard.getByRole('button', { name: 'Cancel appointment', exact: true }).click();
    await secondCard.getByRole('alert').waitFor(); assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: second.id } })).status, 'CONFIRMED');
    await page.unroute(cancelUrl);
    const cancelGate = new Promise<void>(resolve => { releaseCancel = resolve; });
    await page.route(cancelUrl, async route => { const response = await route.fetch(); await cancelGate; await route.fulfill({ response }); });
    page.once('dialog', dialog => dialog.accept()); await secondCard.getByRole('button', { name: 'Cancel appointment', exact: true }).click();
    assert.equal(await secondCard.getByRole('button', { name: 'Cancel appointment', exact: true }).isDisabled(), true);
    assert.equal(await secondCard.getByRole('button', { name: 'Reschedule appointment', exact: true }).isDisabled(), true);
    releaseCancel?.(); const thirdCard = page.getByTestId(`active-booking-${third.id}`); await thirdCard.waitFor();
    // A second tab shares the first tab's stream, and its card updates from a signal relayed between them: time passing fetches nothing and never flashes the loading text, and a change elsewhere appears without a reload.
    const earlier = (date: Date) => new Date(+date - 3600000);
    const nextUp = await prisma.booking.create({ data: { businessId: business.id, customerId: customer.id, serviceId: service.id, staffId: staff.id, startsAt: earlier(third.startsAt), endsAt: earlier(third.endsAt), occupiedFrom: earlier(third.occupiedFrom), occupiedUntil: earlier(third.occupiedUntil), status: 'CONFIRMED', idempotencyKey: randomUUID() } });
    const livePage = await context.newPage(); await livePage.clock.install();
    const isStream = (url: string) => url === `${apiUrl}/api/me/appointments/live`;
    let tabStreams = 0; livePage.on('request', request => { if (isStream(request.url())) tabStreams++; });
    await livePage.goto(webUrl);
    const nextCard = livePage.getByTestId(`active-booking-${nextUp.id}`); await nextCard.waitFor(); await new Promise(resolve => setTimeout(resolve, 500));
    let upcomingReads = 0; livePage.on('request', request => { if (request.url() === upcomingUrl) upcomingReads++; });
    await livePage.clock.fastForward(61000); await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(upcomingReads, 0); assert.equal(await nextCard.isVisible(), true);
    assert.equal(await livePage.getByRole('status').filter({ hasText: 'Loading your next appointment…' }).count(), 0);
    // Held open so the card can be checked while the re-read is in flight.
    let releaseReread: (() => void) | undefined; const rereadGate = new Promise<void>(resolve => { releaseReread = resolve; });
    await livePage.route(upcomingUrl, async route => { await rereadGate; await route.continue(); });
    const reread = livePage.waitForRequest(upcomingUrl);
    const cancelledElsewhere = await context.request.post(`${apiUrl}/v1/bookings/${nextUp.id}/cancel`, { headers: { Origin: webUrl }, data: {} });
    assert.equal(cancelledElsewhere.status(), 200, await cancelledElsewhere.text());
    await reread;
    assert.equal(await nextCard.isVisible(), true);
    assert.equal(await livePage.getByRole('status').filter({ hasText: 'Loading your next appointment…' }).count(), 0);
    releaseReread?.();
    await livePage.getByTestId(`active-booking-${third.id}`).waitFor({ timeout: 5000 });
    assert.equal(tabStreams, 0);
    // The tab holding the stream leaves, and the waiting tab takes it over.
    const takenOver = livePage.waitForResponse(response => isStream(response.url()) && response.status() === 200);
    await page.goto('about:blank'); await takenOver;
    await livePage.close(); await page.goto(webUrl);
    assert.equal((await context.request.delete(`${apiUrl}/api/me/providers/${business.id}`, { headers: { Origin: webUrl, 'X-Visit-Expected-Identity': customer.id } })).status(), 200);
    await prisma.business.update({ where: { id: business.id }, data: { publishedAt: null } });
    await page.reload(); await thirdCard.waitFor();
    await thirdCard.getByRole('button', { name: 'View appointment details', exact: true }).click(); await page.waitForURL(`${webUrl}/appointment/${third.id}`);
    await page.goto(`${webUrl}/account`);
    const localeSaved = page.waitForResponse(response => response.url() === `${apiUrl}/api/account/preferences` && response.request().method() === 'PUT');
    await page.getByTestId('language-he').click(); assert.equal((await localeSaved).status(), 200); await page.goto(webUrl);
    await thirdCard.getByRole('heading', { name: 'התור הקרוב שלכם', exact: true }).waitFor();
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: 'test-results/upcoming-home-he-long.png', fullPage: true });
    for (const booking of [first, third]) {
      const current = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
      assert.equal((await context.request.post(`${apiUrl}/v1/bookings/${booking.id}/cancel`, { headers: { Origin: webUrl }, data: { expectedRevision: current.revision } })).status(), 200);
    }
    const emptyRead = page.waitForResponse(response => response.url() === upcomingUrl && response.status() === 200);
    await page.reload(); assert.equal((await (await emptyRead).json()).booking, null);
    await page.getByText('עדיין לא הוספתם נותני שירות', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'נותני השירות שלי', exact: true }).waitFor();
    assert.equal(await page.locator('[data-testid^="active-booking-"]').count(), 0);
    console.log('PASS: owned deterministic Home/contextual appointment, independent loading/error/empty providers, details/multiple actions, reschedule reorder, declined/failed/pending cancellation, unpublished access and Hebrew long-content flow.');
  } finally { releaseLoading?.(); releaseCancel?.(); await context.close(); }
}
