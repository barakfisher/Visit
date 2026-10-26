import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Browser } from 'playwright';
export async function businessAccessSmoke({ browser, webUrl, apiUrl }: { browser: Browser; webUrl: string; apiUrl: string }) {
  const { prisma } = await import('../../api/src/db/client.js');
  const { redis, ensureRedisReady } = await import('../../api/src/infra/redis.js');
  const { newOpaqueToken, tokenDigest, sessionExpiry } = await import('../../api/src/security/sessions.js');
  const ids: string[] = []; let businessId = '';
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext({ viewport: { width: 390, height: 844 } })));
  const errors: string[] = [];
  try {
    const people = [];
    for (let n = 0; n < 4; n++) {
      const identity = await prisma.identity.create({ data: { email: `access-web-${randomUUID()}@example.test`, emailVerifiedAt: new Date(), preferredLocale: 'en', platformRole: n === 3 ? 'ADMIN' : 'USER' } }); ids.push(identity.id); people.push(identity);
      const token = newOpaqueToken(); await prisma.session.create({ data: { identityId: identity.id, tokenHash: tokenDigest(token), expiresAt: sessionExpiry() } });
      await contexts[n]!.addCookies([{ name: 'visit_session', value: token, url: webUrl, httpOnly: true, sameSite: 'Lax' }]);
      await contexts[n]!.addInitScript(() => localStorage.setItem('visit.locale.v1.guest', 'en'));
    }
    const business = await prisma.business.create({ data: { name: 'Access fixture studio', slug: `access-${randomUUID()}`, timezone: 'Asia/Jerusalem', approvalStatus: 'APPROVED', publishedAt: new Date() } }); businessId = business.id;
    await prisma.membership.create({ data: { identityId: ids[0]!, businessId, role: 'OWNER', status: 'ACTIVE' } });
    const pages = await Promise.all(contexts.map(context => context.newPage())); pages.forEach(page => page.on('pageerror', error => errors.push(error.message)));
    const [owner, recipient, stranger, admin] = pages;
    await owner!.goto(`${webUrl}/provider/team/${businessId}`);
    await owner!.getByRole('heading', { name: 'Team access' }).waitFor();
    await owner!.getByLabel('Verified recipient contact').fill(people[1]!.email!);
    await owner!.getByRole('button', { name: 'Manager', exact: true }).click();
    await owner!.getByRole('button', { name: 'Create private invitation', exact: true }).click();
    const link = owner!.getByTestId('private-invitation-link'); await link.waitFor(); const inviteUrl = await link.innerText(); const secret = new URL(inviteUrl).hash.slice(8);
    assert.equal((await prisma.businessInvitation.findFirstOrThrow({ where: { businessId } })).tokenHash, tokenDigest(secret));
    const leaked: string[] = []; recipient!.on('request', request => { if (request.url().includes(secret)) leaked.push(request.url()); });
    await stranger!.goto(inviteUrl); await stranger!.getByRole('button', { name: 'Review invitation' }).click(); await stranger!.getByRole('alert').filter({ hasText: 'does not match' }).waitFor();
    await recipient!.goto(inviteUrl); await recipient!.getByRole('button', { name: 'Review invitation' }).waitFor();
    await recipient!.waitForURL(url => url.pathname === '/invite' && !url.hash);
    assert.equal(await prisma.membership.count({ where: { identityId: ids[1], businessId } }), 0);
    await recipient!.getByRole('button', { name: 'Review invitation' }).click();
    await recipient!.waitForURL(url => url.pathname === '/invite' && !url.hash);
    assert.equal(await recipient!.evaluate(value => JSON.stringify({ history: history.state, local: { ...localStorage }, session: { ...sessionStorage } }).includes(value), secret), false);
    await recipient!.getByText('Access fixture studio', { exact: true }).waitFor();
    await recipient!.getByRole('button', { name: 'Accept invitation' }).click(); await recipient!.getByRole('status').filter({ hasText: 'Invitation accepted' }).waitFor();
    await recipient!.waitForURL(url => url.pathname === '/invite' && !url.hash);
    assert.deepEqual(leaked, []);
    await recipient!.goto(`${webUrl}/provider/team/${businessId}`); await recipient!.getByLabel('Verified recipient contact').waitFor();
    assert.equal(await recipient!.getByRole('button', { name: 'Manager', exact: true }).count(), 0);
    await recipient!.getByLabel('Verified recipient contact').fill(people[2]!.email!); await recipient!.getByRole('button', { name: 'Create private invitation' }).click(); await recipient!.getByTestId('private-invitation-link').waitFor();
    const subordinateLink = await recipient!.getByTestId('private-invitation-link').innerText();
    await owner!.reload(); const member = owner!.getByTestId(`team-member-${ids[1]}`);
    await member.getByRole('button', { name: 'Remove access', exact: true }).click(); await member.getByRole('button', { name: 'Confirm removal', exact: true }).click();
    await member.waitFor({ state: 'hidden' });
    await stranger!.goto(subordinateLink); await stranger!.getByRole('button', { name: 'Review invitation' }).click(); await stranger!.getByRole('alert').waitFor();
    assert.equal((await contexts[1]!.request.get(`${apiUrl}/v1/provider/businesses/${businessId}/team`)).status(), 403);
    await admin!.goto(`${webUrl}/admin/ownership`);
    await admin!.getByLabel('Business ID', { exact: true }).fill(businessId); await admin!.getByLabel('Verified claimant identity ID').fill(ids[2]!);
    await admin!.getByLabel('Evidence case reference').fill(`ui-case-${randomUUID()}`); await admin!.getByLabel('Evidence summary').fill('Synthetic owner consent checked in this isolated browser test.');
    await admin!.getByRole('button', { name: 'Record evidence case' }).click(); await admin!.getByLabel('Decision reason').fill('Synthetic original ownership records reviewed.');
    await admin!.getByRole('button', { name: 'Approve ownership', exact: true }).click(); await admin!.getByRole('button', { name: 'Confirm ownership grant', exact: true }).click(); await admin!.getByLabel('Decision reason').waitFor({ state: 'hidden' });
    assert.equal(await prisma.membership.count({ where: { businessId, identityId: ids[2], role: 'OWNER', status: 'ACTIVE' } }), 1);
    assert.equal((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).publishedAt!.getTime(), business.publishedAt!.getTime());
    await stranger!.goto(`${webUrl}/account`); await stranger!.getByRole('heading', { name: 'Sign-in methods', exact: true }).waitFor();
    const saved = stranger!.waitForResponse(r => r.url().endsWith('/api/account/preferences') && r.ok()); await stranger!.getByTestId('language-he').click(); await saved;
    await stranger!.goto(`${webUrl}/provider/team/${businessId}`); await stranger!.getByRole('heading', { name: 'הרשאות צוות', exact: true }).waitFor(); assert.equal(await stranger!.locator('html').getAttribute('dir'), 'rtl');
    assert.deepEqual(errors, []);
    console.log('PASS: private invite creation, scrubbed explicit consent, verified recipient, manager limits, revocation, audited ownership review and Hebrew team UI.');
  } catch (error) {
    for (const context of contexts) for (const page of context.pages()) console.error((await page.locator('body').innerText()).slice(0, 2500));
    throw error;
  } finally {
    await Promise.all(contexts.map(c => c.close()));
    if (businessId) {
      await prisma.businessAccessEvent.deleteMany({ where: { businessId } }); await prisma.businessOwnershipReview.deleteMany({ where: { businessId } }); await prisma.businessInvitation.deleteMany({ where: { businessId } });
      await prisma.business.delete({ where: { id: businessId } });
    }
    await prisma.identity.deleteMany({ where: { id: { in: ids } } }); if (ids.length) { await ensureRedisReady(); await redis.del(...ids.map(id => `visit:invitation-limit:${id}`)); }
  }
}
