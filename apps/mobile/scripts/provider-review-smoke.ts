import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import type { Browser, BrowserContext } from 'playwright';
import type { prisma as Prisma } from '../../api/src/db/client.js';
export async function providerReviewSmoke({ browser, webUrl, apiUrl, prisma, run, identityIds, businessIds }: { browser: Browser; webUrl: string; apiUrl: string; prisma: typeof Prisma; run: string; identityIds: string[]; businessIds: string[] }) {
  const contexts: BrowserContext[] = [], errors: string[] = [];
  async function session(admin = false) {
    const person = await prisma.identity.create({ data: { email: `review-${admin ? 'admin' : 'applicant'}-${run}@example.test`, emailVerifiedAt: new Date(), platformRole: admin ? 'ADMIN' : 'USER' } }); identityIds.push(person.id);
    const token = randomBytes(32).toString('base64url');
    await prisma.session.create({ data: { identityId: person.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600000) } });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(context);
    await context.addCookies([{ name: 'visit_session', value: token, url: apiUrl, httpOnly: true, sameSite: 'Lax' }]);
    await context.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en'));
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    return { context, page, person };
  }
  try {
    const applicant = await session(), admin = await session(true);
    await applicant.page.goto(`${webUrl}/register/provider`);
    await applicant.page.getByRole('textbox', { name: 'Business name', exact: true }).fill('Pilot review studio');
    const slug = `review-ui-${run}`;
    await applicant.page.getByRole('textbox', { name: 'Business URL name', exact: true }).fill(slug);
    const submitted = applicant.page.waitForResponse(r => r.url() === `${apiUrl}/v1/provider-applications` && r.request().method() === 'POST');
    await applicant.page.getByRole('button', { name: 'Submit for approval', exact: true }).click();
    assert.equal((await submitted).status(), 201);
    const business = await prisma.business.findUniqueOrThrow({ where: { slug } }); businessIds.push(business.id);
    await applicant.page.getByText('Pending review', { exact: true }).waitFor();
    assert.equal((await applicant.context.request.get(`${apiUrl}/v1/admin/provider-applications`)).status(), 403);
    await admin.page.goto(`${webUrl}/admin/applications`);
    const card = admin.page.getByText('Pilot review studio', { exact: true }).locator('..');
    await card.getByRole('textbox', { name: 'Review reason', exact: true }).fill('Verified new business application and ownership evidence.');
    await card.getByRole('button', { name: 'Approve application', exact: true }).click();
    await admin.page.getByText('Decision recorded. The applicant can see their status.', { exact: true }).waitFor();
    await applicant.page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await applicant.page.getByText('Approved — complete business setup before publishing', { exact: true }).waitFor();
    assert.equal(await applicant.page.getByRole('button', { name: 'Submit for approval', exact: true }).count(), 0);
    await applicant.page.getByText(/Verified new business application and ownership evidence/).waitFor();
    assert.equal((await prisma.business.findUniqueOrThrow({ where: { id: business.id } })).publishedAt, null);
    assert.equal(await prisma.membership.count({ where: { businessId: business.id, identityId: applicant.person.id, status: 'ACTIVE' } }), 1);
    await applicant.page.screenshot({ path: 'test-results/provider-review-approved-en-mobile.png', fullPage: true });
    const base = `${apiUrl}/v1/provider/businesses/${business.id}`;
    const headers = { Origin: webUrl };
    assert.equal((await applicant.context.request.patch(base, { headers, data: { location: 'Jerusalem', category: 'Wellness' } })).status(), 200);
    const service = await (await applicant.context.request.post(`${base}/services`, { headers, data: { name: 'Pilot consultation', durationMinutes: 30, priceMinor: 10000, currency: 'ILS' } })).json();
    assert.equal((await applicant.context.request.post(`${base}/staff`, { headers, data: { displayName: 'Pilot expert', serviceIds: [service.id] } })).status(), 201);
    assert.equal((await applicant.context.request.put(`${base}/availability-rules`, { headers, data: { weekly: Array.from({ length: 7 }, (_, weekday) => ({ weekday, intervals: [{ startLocal: '09:00', endLocal: '17:00' }] })), overrides: [] } })).status(), 200);
    assert.equal((await applicant.context.request.put(`${base}/booking-policy`, { headers, data: { minimumNoticeMinutes: 0, maximumAdvanceDays: 30, bufferBeforeMinutes: 0, bufferAfterMinutes: 0, cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 0 } })).status(), 200);
    assert.equal((await applicant.context.request.get(`${apiUrl}/api/providers/${business.id}`)).status(), 404);
    await applicant.page.goto(`${webUrl}/provider/dashboard?businessId=${business.id}`);
    await applicant.page.getByRole('button', { name: 'Publish business', exact: true }).click();
    await applicant.page.getByText('Published — ready for bookings', { exact: true }).waitFor();
    assert.equal((await applicant.context.request.get(`${apiUrl}/api/providers/${business.id}`)).status(), 200);
    await applicant.page.screenshot({ path: 'test-results/provider-published-en-mobile.png', fullPage: true });
    await applicant.page.getByRole('button', { name: 'Unpublish business', exact: true }).click();
    await applicant.page.getByText('Not published', { exact: true }).waitFor();
    assert.equal((await applicant.context.request.get(`${apiUrl}/api/providers/${business.id}`)).status(), 404);
    console.log('PASS: business setup -> readiness -> publish -> direct public detail -> unpublish through the provider UI.');
    assert.deepEqual(errors, []);
    console.log('PASS: unified business application, admin-only reasoned review, applicant refresh/fallback, intended membership and unpublished state.');
  } finally { await Promise.all(contexts.map(c => c.close())); }
}
