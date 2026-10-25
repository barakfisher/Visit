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
    const { configureBusinessSmoke, sharingBusinessSmoke } = await import('./business-setup-smoke.js');
    const setup = await configureBusinessSmoke({ page: applicant.page, context: applicant.context, webUrl, apiUrl, businessId: business.id });
    assert.equal((await applicant.context.request.get(`${apiUrl}/api/providers/${business.id}`)).status(), 404);
    await applicant.page.getByRole('button', { name: 'Publish business', exact: true }).click();
    await applicant.page.getByText('Published — ready for bookings', { exact: true }).waitFor();
    assert.equal((await applicant.context.request.get(`${apiUrl}/api/providers/${business.id}`)).status(), 200);
    await sharingBusinessSmoke({ page: applicant.page, context: applicant.context, webUrl, apiUrl, businessId: business.id, slug });
    const closed = await (await applicant.context.request.get(`${apiUrl}/api/providers/${business.id}/availability?serviceId=${setup.serviceId}&date=${setup.closedDate}`)).json(); assert.equal(closed.slots.length, 0);
    const bookableDate = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
    const open = await (await applicant.context.request.get(`${apiUrl}/api/providers/${business.id}/availability?serviceId=${setup.serviceId}&date=${bookableDate}`)).json(); assert.ok(open.slots.some((slot: { available: boolean }) => slot.available));
    await applicant.page.screenshot({ path: 'test-results/provider-published-en-mobile.png', fullPage: true });
    await applicant.page.getByRole('button', { name: 'Unpublish business', exact: true }).click();
    await applicant.page.getByText('Not published', { exact: true }).waitFor();
    await applicant.page.getByTestId('provider-sharing-qr').waitFor({ state: 'hidden' });
    assert.equal(await applicant.page.getByRole('button', { name: 'Copy booking link', exact: true }).isDisabled(), true);
    assert.equal((await applicant.context.request.get(`${apiUrl}/api/providers/${business.id}`)).status(), 404);
    console.log('PASS: business setup -> readiness -> publish -> direct public detail -> unpublish through the provider UI.');
    assert.deepEqual(errors, []);
    console.log('PASS: unified business application, admin-only reasoned review, applicant refresh/fallback, intended membership and unpublished state.');
  } finally { await Promise.all(contexts.map(c => c.close())); }
}
