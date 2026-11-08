import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import type { Browser } from 'playwright';
import type { prisma as Prisma } from '../../api/src/db/client.js';
import { summaryText } from './business-setup-smoke.js';
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
    // Hours live in business settings (decisions.md, 2026-11-02).
    await page.getByRole('button', { name: 'Account', exact: true }).click(); await page.getByRole('button', { name: 'Business settings', exact: true }).filter({ visible: true }).click();
    await page.getByTestId('setup-guide-hours').filter({ visible: true }).click(); await page.getByRole('heading', { name: 'Business hours', exact: true }).filter({ visible: true }).waitFor();
    // Closing Tuesday would strand the appointment and the active reservation on that day: nothing is written.
    await page.getByRole('button', { name: 'Edit hours', exact: true }).filter({ visible: true }).click();
    const dialog = page.getByTestId('hours-form'), save = dialog.getByRole('button', { name: 'Save hours', exact: true });
    await dialog.getByRole('checkbox', { name: 'Tuesday', exact: true }).click();
    assert.equal(await dialog.getByRole('textbox', { name: 'Opening time 1', exact: true }).inputValue(), '00:00');
    await dialog.getByRole('switch', { name: 'Closed on these days', exact: true }).click();
    const hoursBefore = await prisma.businessWeeklyAvailability.findMany({ where: { businessId: business.id }, orderBy: { id: 'asc' } });
    let writes = 0; await page.route(base, async route => { if (route.request().method() === 'PUT') writes++; await route.continue(); });
    const previewed = page.waitForResponse(response => response.url() === `${base}/preview`); await save.click(); assert.equal((await previewed).status(), 200);
    const impact = dialog.getByTestId('schedule-impact'); await impact.getByText('Active temporary reservation', { exact: true }).waitFor();
    await impact.getByText('Existing appointment', { exact: true }).waitFor();
    assert.equal(writes, 0); await page.unroute(base);
    assert.deepEqual(await prisma.businessWeeklyAvailability.findMany({ where: { businessId: business.id }, orderBy: { id: 'asc' } }), hoursBefore);
    assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: first.id } })).status, 'CONFIRMED');
    // Any edit clears the refusal; reopening Tuesday is safe.
    await dialog.getByRole('switch', { name: 'Closed on these days', exact: true }).click(); assert.equal(await impact.count(), 0);
    await dialog.getByRole('textbox', { name: 'Closing time 1', exact: true }).fill('23:00');
    // An appointment change between the preview and the write invalidates the preview token.
    let moved = false;
    await page.route(base, async route => {
      if (route.request().method() === 'PUT' && !moved) { moved = true; await prisma.booking.update({ where: { id: second.id }, data: { startsAt: new Date(+second.startsAt + 60000), endsAt: new Date(+second.endsAt + 60000), occupiedFrom: new Date(+second.occupiedFrom + 60000), occupiedUntil: new Date(+second.occupiedUntil + 60000) } }); }
      await route.continue();
    });
    const stale = page.waitForResponse(response => response.url() === base && response.request().method() === 'PUT');
    await save.click(); assert.equal((await stale).status(), 409);
    await dialog.getByRole('alert').filter({ hasText: 'Your changes are still here' }).waitFor();
    assert.equal(await dialog.getByRole('textbox', { name: 'Closing time 1', exact: true }).inputValue(), '23:00');
    await page.unroute(base);
    const gate = new Promise<void>(resolve => { releaseSave = resolve; });
    await page.route(base, async route => { if (route.request().method() === 'PUT') { await gate; await route.continue(); } else await route.continue(); });
    const committed = page.waitForResponse(response => response.url() === base && response.request().method() === 'PUT');
    await save.click(); await page.waitForRequest(request => request.url() === base && request.method() === 'PUT');
    assert.equal(await save.isDisabled(), true); assert.equal(await dialog.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(), true);
    // A saved schedule stays on the hours screen with the new summary.
    releaseSave?.(); assert.equal((await committed).status(), 200); await page.unroute(base);
    await dialog.waitFor({ state: 'detached' }); await page.getByRole('status').filter({ hasText: 'Hours saved.' }).filter({ visible: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, `/provider/${business.id}/hours`);
    assert.equal(await summaryText(page, 'hours-group-2'), 'Tue: 00:00–23:00');
    await page.getByTestId('app-footer').getByRole('button', { name: 'Home', exact: true }).click();
    // Leaving the agenda clears its draft by design, so the date is chosen again.
    await page.getByLabel('Agenda date', { exact: true }).filter({ visible: true }).fill(date); await firstCard.waitFor();
    // Blocking the whole business on a day with an appointment is refused, lists it, and writes nothing.
    const blockUrl = `${apiUrl}/api/provider/block-time`, blockForm = page.getByTestId('block-form');
    await page.getByRole('button', { name: 'Block time / add a break', exact: true }).click();
    assert.equal(await blockForm.getByRole('textbox', { name: 'Date', exact: true }).inputValue(), date);
    await blockForm.getByRole('radio', { name: 'Whole days', exact: true }).click();
    const refused = page.waitForResponse(response => response.url() === blockUrl && response.request().method() === 'POST');
    await blockForm.getByRole('button', { name: 'Save block', exact: true }).click(); assert.equal((await refused).status(), 409);
    const conflicts = blockForm.getByTestId('block-conflicts'); await conflicts.getByRole('alert').filter({ hasText: 'nothing was saved' }).waitFor();
    await conflicts.getByText(/Agenda expert/).first().waitFor();
    assert.equal(await prisma.timeBlock.count({ where: { businessId: business.id } }), 0);
    await page.screenshot({ path: 'test-results/agenda-block-conflict-en-mobile.png' });
    // A free day blocks, shows on that day as the whole business, all day, and removes after a confirmation.
    const freeDate = new Date(+nextTuesday + 2 * 86400000).toISOString().slice(0, 10);
    await blockForm.getByRole('textbox', { name: 'First day', exact: true }).fill(freeDate); await blockForm.getByRole('textbox', { name: 'Last day', exact: true }).fill(freeDate);
    await blockForm.getByRole('textbox', { name: 'Reason (optional)', exact: true }).fill('Holiday');
    const blocked = page.waitForResponse(response => response.url() === blockUrl && response.request().method() === 'POST');
    await blockForm.getByRole('button', { name: 'Save block', exact: true }).click(); assert.equal((await blocked).status(), 201); await blockForm.waitFor({ state: 'detached' });
    assert.deepEqual((await prisma.timeBlock.findMany({ where: { businessId: business.id }, select: { staffId: true, allDay: true, reason: true } })), [{ staffId: null, allDay: true, reason: 'Holiday' }]);
    await page.getByLabel('Agenda date', { exact: true }).filter({ visible: true }).fill(freeDate);
    const agendaBlocks = page.getByTestId('agenda-blocks'); await agendaBlocks.getByText('Whole business · Holiday', { exact: true }).waitFor();
    await agendaBlocks.getByText(/All day/).waitFor();
    await agendaBlocks.getByRole('button', { name: 'Remove block', exact: true }).click(); await agendaBlocks.getByRole('button', { name: 'Confirm', exact: true }).click();
    await agendaBlocks.waitFor({ state: 'detached' }); assert.equal(await prisma.timeBlock.count({ where: { businessId: business.id } }), 0);
    await page.getByLabel('Agenda date', { exact: true }).filter({ visible: true }).fill(date); await firstCard.waitFor();
    page.once('dialog', dialog => dialog.dismiss()); await firstCard.getByRole('button', { name: 'Cancel appointment', exact: true }).click(); assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: first.id } })).status, 'CONFIRMED');
    const cancelUrl = `${apiUrl}/v1/provider/businesses/${business.id}/bookings/${first.id}/cancel`;
    await page.route(cancelUrl, route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE"}}' }));
    page.once('dialog', dialog => dialog.accept()); await firstCard.getByRole('button', { name: 'Cancel appointment', exact: true }).click(); await firstCard.getByRole('alert').waitFor(); assert.equal((await prisma.booking.findUniqueOrThrow({ where: { id: first.id } })).status, 'CONFIRMED');
    await page.unroute(cancelUrl); page.once('dialog', dialog => dialog.accept()); await firstCard.getByRole('button', { name: 'Cancel appointment', exact: true }).click(); await firstCard.getByText('Cancelled', { exact: true }).waitFor();
    await page.goto(`${webUrl}/account`); const localeSaved = page.waitForResponse(response => response.url() === `${apiUrl}/api/account/preferences` && response.request().method() === 'PUT'); await page.getByTestId('language-he').click(); assert.equal((await localeSaved).status(), 200);
    await page.goto(`${webUrl}/provider/dashboard?businessId=${business.id}`); await page.getByLabel('תאריך ביומן', { exact: true }).fill(date); await page.getByRole('button', { name: 'תצוגה שבועית', exact: true }).click(); await page.getByText('יומן שבועי', { exact: true }).waitFor();
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl'); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: 'test-results/agenda-week-he-mobile.png', fullPage: true }); await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: 'test-results/agenda-week-he-desktop.png', fullPage: true });
    console.log('PASS: local daily/weekly agenda, loading/error/retry/empty, hours dialog no-write conflict, block refusal over appointments and a whole-business day block, active hold protection, stale preview refusal, pending commit that stays on the hours screen, declined/failed/successful provider cancellation and Hebrew RTL.');
  } finally { releaseLoading?.(); releaseSave?.(); await context.close(); }
}
