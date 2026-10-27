import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Browser } from 'playwright';
import type { prisma as Prisma } from '../../api/src/db/client.js';
export async function providerAgendaSmoke({ browser, webUrl, apiUrl, prisma, run, businessIds, identityIds }: { browser: Browser; webUrl: string; apiUrl: string; prisma: typeof Prisma; run: string; businessIds: string[]; identityIds: string[] }) {
  const business = await prisma.business.create({ data: { name: 'Agenda studio — סטודיו לייעוץ ושירות אישי', slug: `agenda-web-${run}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } }); businessIds.push(business.id);
  const owner = await prisma.identity.create({ data: { email: `agenda-web-${run}@example.test`, preferredLocale: 'en' } }), customer = await prisma.identity.create({ data: { email: `agenda-customer-${run}@example.test` } }); identityIds.push(owner.id, customer.id);
  await prisma.membership.create({ data: { businessId: business.id, identityId: owner.id, role: 'OWNER', status: 'ACTIVE' } });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Reserved consultation — פגישת ייעוץ', durationMinutes: 30, priceMinor: 10000, currency: 'ILS' } }), staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Agenda expert' } });
  await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 60, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0, bufferBeforeMinutes: 5, bufferAfterMinutes: 5 } });
  await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '00:00', endLocal: '23:59' })) });
  const nextTuesday = new Date(Date.now() + 3 * 86400000); while (nextTuesday.getUTCDay() !== 2) nextTuesday.setUTCDate(nextTuesday.getUTCDate() + 1);
  const date = nextTuesday.toISOString().slice(0, 10), nextDate = new Date(+nextTuesday + 86400000).toISOString().slice(0, 10);
  async function create(day: string, hour: number, status: 'CONFIRMED' | 'HELD' = 'CONFIRMED') {
    const startsAt = new Date(`${day}T${String(hour).padStart(2, '0')}:00:00Z`), endsAt = new Date(+startsAt + 1800000);
    return prisma.booking.create({ data: { businessId: business.id, customerId: customer.id, staffId: staff.id, serviceId: service.id, startsAt, endsAt, occupiedFrom: new Date(+startsAt - 300000), occupiedUntil: new Date(+endsAt + 300000), status, holdExpiresAt: status === 'HELD' ? new Date(Date.now() + 300000) : null, idempotencyKey: randomUUID() } });
  }
  const first = await create(date, 9), second = await create(nextDate, 10), held = await create(date, 12, 'HELD');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Pacific/Auckland' });
  let releaseLoading: (() => void) | undefined, releaseSave: (() => void) | undefined;
  try {
    const token = randomUUID(); await prisma.session.create({ data: { identityId: owner.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 900000) } });
    await context.addCookies([{ name: 'visit_session', value: token, url: apiUrl, httpOnly: true, sameSite: 'Lax' }]); await context.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en'));
    const page = await context.newPage(), base = `${apiUrl}/v1/provider/businesses/${business.id}/availability-rules`;
    let blockAgenda = true, failAgenda = false;
    const loading = new Promise<void>(resolve => { releaseLoading = resolve; });
    await page.route('**/api/provider/agenda?**', async route => { if (blockAgenda) await loading; if (failAgenda) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE"}}' }); else await route.continue(); });
    await page.goto(`${webUrl}/provider/dashboard?businessId=${business.id}`); await page.getByText('Loading agenda…', { exact: true }).waitFor(); blockAgenda = false; releaseLoading?.();
    await page.getByLabel('Agenda date', { exact: true }).fill(date);
    const firstCard = page.getByTestId(`agenda-booking-${first.id}`), secondCard = page.getByTestId(`agenda-booking-${second.id}`); await firstCard.waitFor(); assert.equal(await secondCard.count(), 0);
    await page.getByRole('button', { name: 'Week view', exact: true }).click(); await secondCard.waitFor();
    await page.getByText('Weekly agenda', { exact: true }).waitFor(); assert.equal(await page.getByTestId(`agenda-booking-${held.id}`).count(), 0);
    await page.getByRole('button', { name: 'Next period', exact: true }).click(); await page.getByText('No appointments for this week.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Previous period', exact: true }).click(); await firstCard.waitFor();
    failAgenda = true; await page.getByRole('button', { name: 'Next period', exact: true }).click(); await page.getByRole('alert').filter({ hasText: 'The agenda could not load.' }).waitFor();
    failAgenda = false; await page.getByRole('button', { name: 'Try again', exact: true }).click(); await page.getByText('No appointments for this week.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Previous period', exact: true }).click(); await firstCard.waitFor();
    await page.getByRole('tab', { name: 'Working Hours', exact: true }).click();
    await page.getByRole('button', { name: 'Add date exception', exact: true }).click();
    await page.getByLabel('Exception date 1 (YYYY-MM-DD)', { exact: true }).fill(date);
    const hoursBefore = await prisma.businessWeeklyAvailability.findMany({ where: { businessId: business.id }, orderBy: { id: 'asc' } });
    await page.getByRole('button', { name: 'Save working hours', exact: true }).click();
    const impact = page.getByTestId('schedule-impact'); await impact.getByRole('button', { name: 'Confirm schedule change', exact: true }).waitFor();
    await impact.getByText('Active temporary reservation', { exact: true }).waitFor();
    assert.equal(await impact.getByRole('button', { name: 'Confirm schedule change', exact: true }).isDisabled(), true);
    assert.deepEqual(await prisma.businessWeeklyAvailability.findMany({ where: { businessId: business.id }, orderBy: { id: 'asc' } }), hoursBefore);
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: first.id } })).status, 'CONFIRMED');
    await page.getByRole('button', { name: 'Remove date exception 1', exact: true }).click();
    await page.getByRole('button', { name: 'Save working hours', exact: true }).click(); await impact.getByRole('button', { name: 'Confirm schedule change', exact: true }).waitFor();
    // An appointment change after review must invalidate the saved preview token.
    await prisma.booking.update({ where: { id: second.id }, data: { startsAt: new Date(+second.startsAt + 60000), endsAt: new Date(+second.endsAt + 60000), occupiedFrom: new Date(+second.occupiedFrom + 60000), occupiedUntil: new Date(+second.occupiedUntil + 60000) } });
    const stale = page.waitForResponse(response => response.url() === base && response.request().method() === 'PUT');
    await impact.getByRole('button', { name: 'Confirm schedule change', exact: true }).click(); assert.equal((await stale).status(), 409);
    await page.getByRole('alert').filter({ hasText: 'Your draft is retained.' }).waitFor();
    await page.getByRole('button', { name: 'Save working hours', exact: true }).click();
    const gate = new Promise<void>(resolve => { releaseSave = resolve; });
    await page.route(base, async route => { if (route.request().method() === 'PUT') { await gate; await route.continue(); } else await route.continue(); });
    await impact.getByRole('button', { name: 'Confirm schedule change', exact: true }).click(); assert.equal(await impact.getByRole('button', { name: 'Confirm schedule change', exact: true }).isDisabled(), true);
    releaseSave?.(); await page.getByText('Changes saved.', { exact: true }).waitFor(); await page.unroute(base);
    await page.getByRole('tab', { name: 'Agenda View', exact: true }).click(); await firstCard.waitFor();
    page.once('dialog', dialog => dialog.dismiss()); await firstCard.getByRole('button', { name: 'Cancel appointment', exact: true }).click(); assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: first.id } })).status, 'CONFIRMED');
    const cancelUrl = `${apiUrl}/v1/provider/businesses/${business.id}/bookings/${first.id}/cancel`;
    await page.route(cancelUrl, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE"}}' }));
    page.once('dialog', dialog => dialog.accept()); await firstCard.getByRole('button', { name: 'Cancel appointment', exact: true }).click(); await firstCard.getByRole('alert').waitFor(); assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: first.id } })).status, 'CONFIRMED');
    await page.unroute(cancelUrl); page.once('dialog', dialog => dialog.accept()); await firstCard.getByRole('button', { name: 'Cancel appointment', exact: true }).click(); await firstCard.getByText('Cancelled', { exact: true }).waitFor();
    await page.goto(`${webUrl}/account`); const localeSaved = page.waitForResponse(response => response.url() === `${apiUrl}/api/account/preferences` && response.request().method() === 'PUT'); await page.getByTestId('language-he').click(); assert.equal((await localeSaved).status(), 200);
    await page.goto(`${webUrl}/provider/dashboard?businessId=${business.id}`); await page.getByLabel('תאריך ביומן', { exact: true }).fill(date); await page.getByRole('button', { name: 'תצוגה שבועית', exact: true }).click(); await page.getByText('יומן שבועי', { exact: true }).waitFor();
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: 'test-results/agenda-week-he-mobile.png', fullPage: true }); await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: 'test-results/agenda-week-he-desktop.png', fullPage: true });
    console.log('PASS: local daily/weekly agenda, loading/error/retry/empty, schedule impact no-write conflict, active hold protection, stale review refusal, pending commit, declined/failed/successful provider cancellation and Hebrew RTL.');
  } finally { releaseLoading?.(); releaseSave?.(); await context.close(); }
}
