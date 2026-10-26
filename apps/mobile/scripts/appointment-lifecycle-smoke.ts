import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import type { Browser } from 'playwright';
import type { prisma as Prisma } from '../../api/src/db/client.js';
export async function appointmentLifecycleSmoke({ browser, webUrl, apiUrl, prisma, run, businessIds, identityIds }: { browser: Browser; webUrl: string; apiUrl: string; prisma: typeof Prisma; run: string; businessIds: string[]; identityIds: string[] }) {
  const business = await prisma.business.create({ data: { name: `Lifecycle browser ${run.slice(0, 6)}`, slug: `lifecycle-web-${run}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } }); businessIds.push(business.id);
  const owner = await prisma.identity.create({ data: { email: `lifecycle-owner-${run}@example.test`, preferredLocale: 'en' } }), customer = await prisma.identity.create({ data: { email: `lifecycle-customer-${run}@example.test`, preferredLocale: 'en' } }); identityIds.push(owner.id, customer.id);
  await prisma.membership.create({ data: { identityId: owner.id, businessId: business.id, role: 'OWNER', status: 'ACTIVE' } });
  const service = await prisma.service.create({ data: { businessId: business.id, name: 'Lifecycle consultation', durationMinutes: 30, priceMinor: 12500, currency: 'ILS' } });
  const staff = await prisma.staff.create({ data: { businessId: business.id, displayName: 'Lifecycle specialist' } });
  await prisma.staffService.create({ data: { businessId: business.id, staffId: staff.id, serviceId: service.id } });
  await prisma.bookingPolicy.create({ data: { businessId: business.id, minimumNoticeMinutes: 0, maximumAdvanceDays: 30, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } });
  await prisma.businessWeeklyAvailability.createMany({ data: Array.from({ length: 7 }, (_, weekday) => ({ businessId: business.id, weekday, startLocal: '00:00', endLocal: '23:59' })) });
  const past = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), future = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const bookings = [];
  for (const [index, date] of [past, past, past, future].entries()) {
    const startsAt = new Date(`${date}T${9 + index}:00:00Z`.replace('T9:', 'T09:')), endsAt = new Date(+startsAt + 1800000);
    bookings.push(await prisma.booking.create({ data: { businessId: business.id, customerId: customer.id, staffId: staff.id, serviceId: service.id, startsAt, endsAt, occupiedFrom: startsAt, occupiedUntil: endsAt, status: 'CONFIRMED', idempotencyKey: `lifecycle-${run}-${index}` } }));
  }
  const [completed, noShow, cancelled, scheduled] = bookings; assert.ok(completed && noShow && cancelled && scheduled);
  await prisma.service.update({ where: { id: service.id }, data: { name: 'Changed live catalog', durationMinutes: 60, priceMinor: 99900 } });
  const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Los_Angeles' }), customerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Pacific/Auckland' });
  try {
    for (const [context, person] of [[ownerContext, owner], [customerContext, customer]] as const) {
      const token = randomBytes(32).toString('base64url');
      await prisma.session.create({ data: { identityId: person.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600000) } });
      await context.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en'));
      await context.addCookies([{ name: 'visit_session', value: token, url: apiUrl, httpOnly: true, sameSite: 'Lax' }]);
    }
    const page = await ownerContext.newPage();
    await page.goto(`${webUrl}/provider/dashboard?businessId=${business.id}`);
    await page.getByLabel('Agenda date', { exact: true }).fill(past);
    const completeCard = page.getByTestId(`agenda-booking-${completed.id}`);
    await completeCard.getByRole('button', { name: 'Mark completed', exact: true }).click();
    await completeCard.getByText('Completed', { exact: true }).waitFor();
    await completeCard.getByRole('button', { name: 'Show audit history', exact: true }).click();
    await completeCard.getByText('Business manager · Appointment finished', { exact: true }).waitFor();
    const noShowCard = page.getByTestId(`agenda-booking-${noShow.id}`);
    await noShowCard.getByRole('button', { name: 'Mark no-show', exact: true }).click();
    await noShowCard.getByText('No-show', { exact: true }).waitFor();
    page.once('dialog', dialog => dialog.accept());
    const cancelCard = page.getByTestId(`agenda-booking-${cancelled.id}`);
    await cancelCard.getByRole('button', { name: 'Cancel appointment', exact: true }).click();
    await cancelCard.getByText('Cancelled', { exact: true }).waitFor();
    await page.getByLabel('Agenda date', { exact: true }).fill(future);
    const futureCard = page.getByTestId(`agenda-booking-${scheduled.id}`); await futureCard.waitFor();
    assert.equal(await futureCard.getByRole('button', { name: 'Mark completed', exact: true }).count(), 0);
    const customerPage = await customerContext.newPage();
    await customerPage.goto(`${webUrl}/appointments`);
    await customerPage.getByRole('heading', { name: 'Appointment history', exact: true }).waitFor();
    for (const [booking, status] of [[completed, 'Completed'], [noShow, 'No-show'], [cancelled, 'Cancelled'], [scheduled, 'Scheduled']] as const) {
      const card = customerPage.getByTestId(`history-booking-${booking.id}`); await card.getByText(status, { exact: true }).waitFor();
      await card.getByText('Lifecycle consultation', { exact: true }).waitFor();
      assert.equal(await card.getByRole('button', { name: 'Mark completed', exact: true }).count(), 0);
    }
    const owned = customerPage.getByTestId(`history-booking-${completed.id}`);
    await owned.getByRole('button', { name: 'Show audit history', exact: true }).click();
    await owned.getByText('Business manager · Appointment finished', { exact: true }).waitFor();
    await customerPage.reload(); await customerPage.getByTestId(`history-booking-${noShow.id}`).getByText('No-show', { exact: true }).waitFor();
    await customerPage.goto(`${webUrl}/account`); await customerPage.getByTestId('language-he').click();
    await customerPage.goto(`${webUrl}/appointments`); await customerPage.getByRole('heading', { name: 'היסטוריית תורים', exact: true }).waitFor();
    await customerPage.getByTestId(`history-booking-${completed.id}`).getByText('הושלם', { exact: true }).waitFor();
    assert.equal(await customerPage.locator('html').getAttribute('dir'), 'rtl');
    assert.equal(await prisma.savedProvider.count({ where: { identityId: customer.id } }), 0);
    assert.equal(await prisma.bookingEvent.count({ where: { businessId: business.id, kind: { in: ['COMPLETED', 'NO_SHOW', 'CANCELLED'] } } }), 3);
    console.log('PASS: provider completion/no-show/cancellation and immutable audit, future outcome guard, owned persisted customer history without saved provider, service snapshots and Hebrew RTL on traveler devices.');
  } finally { await ownerContext.close(); await customerContext.close(); }
}
