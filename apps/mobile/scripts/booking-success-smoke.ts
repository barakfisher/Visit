import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Browser } from 'playwright';
import type { prisma as Prisma } from '../../api/src/db/client.js';

export async function bookingSuccessSmoke({ browser, webUrl, apiUrl, prisma, run, businessIds, identityIds }: { browser: Browser; webUrl: string; apiUrl: string; prisma: typeof Prisma; run: string; businessIds: string[]; identityIds: string[] }) {
  const business = await prisma.business.create({ data: { name: `Success studio ${run.slice(0, 6)}`, slug: `success-web-${run}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } });
  businessIds.push(business.id);
  const customer = await prisma.identity.create({ data: { email: `success-browser-${run}@example.test`, preferredLocale: 'en' } });
  const foreign = await prisma.identity.create({ data: { email: `success-foreign-browser-${run}@example.test`, preferredLocale: 'en' } });
  identityIds.push(customer.id, foreign.id);
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Success consultation עברית 😀', durationMinutes: 30, priceMinor: 12500, currency: 'ILS' } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Success specialist' } });
  await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  const date = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const createBooking = (hour: number, customerId: string, status: 'CONFIRMED' | 'HELD') => {
    const startsAt = new Date(`${date}T${hour}:00:00Z`), endsAt = new Date(+startsAt + 1800000);
    return prisma.booking.create({ data: { businessId: business.id, customerId, serviceId: service.id, staffId: staff.id, startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, status, holdExpiresAt: status === 'HELD' ? new Date(Date.now() + 300000) : null, idempotencyKey: `success-browser-${run}-${hour}` } });
  };
  const owned = await createBooking(10, customer.id, 'CONFIRMED'), other = await createBooking(11, foreign.id, 'CONFIRMED'), held = await createBooking(12, customer.id, 'HELD');
  const focusBooking = await createBooking(13, customer.id, 'CONFIRMED');
  const noticeCount = await prisma.bookingNotification.count({ where: { businessId: business.id } });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Pacific/Auckland', acceptDownloads: true });
  try {
    const token = randomBytes(32).toString('base64url');
    await prisma.session.create({ data: { identityId: customer.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600000) } });
    await context.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en'));
    await context.addCookies([{ name: 'visit_session', value: token, url: apiUrl, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(), detailsUrl = `${apiUrl}/v1/bookings/${owned.id}/details`;
    const detailsView = page.getByTestId('booking-confirmation');
    let releaseDetails: (() => void) | undefined;
    const detailsGate = new Promise<void>(resolve => { releaseDetails = resolve; });
    const requested = page.waitForRequest(detailsUrl);
    await page.route(detailsUrl, async route => { await detailsGate; await route.continue(); });
    const assertNoSuccess = async () => {
      assert.equal(await detailsView.getByRole('heading', { name: 'You’re all set', exact: true }).count(), 0);
      assert.equal(await detailsView.getByRole('button', { name: 'Add to calendar (.ics)', exact: true }).count(), 0);
    };
    try {
      await page.goto(`${webUrl}/confirmation/${owned.id}`, { waitUntil: 'domcontentloaded' });
      await requested;
      await detailsView.getByText('Loading appointment details…', { exact: true }).waitFor();
      await assertNoSuccess();
    } finally { releaseDetails?.(); }
    await detailsView.getByRole('heading', { name: 'You’re all set', exact: true }).waitFor();
    await detailsView.getByText(service.name, { exact: true }).waitFor();
    await detailsView.getByText('Confirmation recorded in Visit. No SMS or WhatsApp message was sent.', { exact: true }).waitFor();
    await page.unroute(detailsUrl);
    await page.reload();
    await detailsView.getByRole('heading', { name: 'You’re all set', exact: true }).waitFor();
    const downloadEvent = page.waitForEvent('download');
    await detailsView.getByRole('button', { name: 'Add to calendar (.ics)', exact: true }).click();
    const download = await downloadEvent, downloadPath = await download.path();
    assert.ok(downloadPath);
    assert.equal(download.suggestedFilename(), `visit-${owned.id}.ics`);
    const calendar = await readFile(downloadPath, 'utf8'), unfolded = calendar.replace(/\r\n[ \t]/g, '');
    assert.ok(unfolded.includes(`UID:${owned.id}@visit.app`));
    assert.ok(unfolded.includes(`SUMMARY:${service.name} at ${business.name}`));
    assert.ok(unfolded.includes(`DTSTART:${owned.startsAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`));
    for (const line of calendar.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
    await page.route(detailsUrl, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporarily unavailable' }) }));
    await page.reload();
    await detailsView.getByText('Appointment details could not load. Try again.', { exact: true }).waitFor();
    await assertNoSuccess();
    await page.unroute(detailsUrl);
    for (const id of [other.id, held.id, 'missing-booking']) {
      await page.goto(`${webUrl}/confirmation/${id}`);
      await detailsView.getByText('This appointment is unavailable for your account. No booking is confirmed on this page.', { exact: true }).waitFor();
      await assertNoSuccess();
      assert.equal(await detailsView.getByText(service.name, { exact: true }).count(), 0);
    }
    await page.goto(`${webUrl}/confirmation/${focusBooking.id}`);
    await detailsView.getByRole('heading', { name: 'You’re all set', exact: true }).waitFor();
    await detailsView.getByRole('button', { name: 'Your appointments', exact: true }).click();
    await page.getByRole('heading', { name: 'Appointment history', exact: true }).waitFor();
    const cancelledWhileAway = await context.request.post(`${apiUrl}/v1/bookings/${focusBooking.id}/cancel`, { headers: { origin: webUrl }, data: { expectedRevision: focusBooking.revision } });
    assert.equal(cancelledWhileAway.status(), 200, await cancelledWhileAway.text());
    const focusDetailsUrl = `${apiUrl}/v1/bookings/${focusBooking.id}/details`;
    let releaseFocusDetails: (() => void) | undefined;
    const focusGate = new Promise<void>(resolve => { releaseFocusDetails = resolve; });
    await page.route(focusDetailsUrl, async route => { await focusGate; await route.continue(); });
    const focusRequested = page.waitForRequest(focusDetailsUrl);
    try {
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await focusRequested;
      await detailsView.getByText('Loading appointment details…', { exact: true }).waitFor();
      await assertNoSuccess();
      assert.equal(await detailsView.getByRole('button', { name: 'Cancel appointment', exact: true }).count(), 0);
      assert.equal(await detailsView.getByRole('button', { name: 'Reschedule appointment', exact: true }).count(), 0);
      assert.equal(await detailsView.getByText('Your appointment is confirmed and saved.', { exact: true }).count(), 0);
    } finally { releaseFocusDetails?.(); }
    await detailsView.getByText('Cancelled', { exact: true }).waitFor();
    await assertNoSuccess();
    await page.unroute(focusDetailsUrl);
    await page.goto(`${webUrl}/appointment/${owned.id}`);
    await detailsView.getByRole('heading', { name: 'Appointment details', exact: true }).waitFor();
    page.once('dialog', dialog => dialog.accept());
    await detailsView.getByRole('button', { name: 'Cancel appointment', exact: true }).click();
    await detailsView.getByText('Cancelled', { exact: true }).waitFor();
    await page.goto(`${webUrl}/confirmation/${owned.id}`);
    await detailsView.getByText('Cancelled', { exact: true }).waitFor();
    await page.reload();
    await detailsView.getByText('Cancelled', { exact: true }).waitFor();
    await assertNoSuccess();
    await page.goto(`${webUrl}/account`);
    await page.getByTestId('language-he').click();
    await page.goto(`${webUrl}/appointment/${owned.id}`);
    await detailsView.getByRole('heading', { name: 'פרטי התור', exact: true }).waitFor();
    await detailsView.getByText('בוטל', { exact: true }).waitFor();
    await detailsView.getByText('האישור תועד ב־Visit. לא נשלחה הודעת SMS או WhatsApp.', { exact: true }).waitFor();
    assert.equal(await detailsView.getByRole('button', { name: 'הוספה ליומן (.ics)', exact: true }).count(), 0);
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    assert.equal(await prisma.bookingNotification.count({ where: { businessId: business.id } }), noticeCount);
    console.log('PASS: persisted owned confirmation reload/download, delayed/error/foreign/held success guards, stack-focus cancellation refetch, cancellation reload, notification deduplication and Hebrew RTL.');
  } finally { await context.close(); }
}
