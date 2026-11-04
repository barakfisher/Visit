import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import jsQR from 'jsqr';
import type { Page, BrowserContext, Locator } from 'playwright';
import { translate } from '../src/i18n/messages';
// The catalog this setup flow creates through the UI; journeys that book it assert against these values.
export const SETUP_SERVICE = { name: 'Pilot consultation', durationMinutes: 30, price: 100, currency: 'ILS' } as const;
export const SETUP_STAFF_NAME = 'Pilot expert edited';
/** Opens business settings, or one section of it, by URL. Sections are their own screens (decisions.md, 2026-11-02). */
export async function openSettings(page: Page, webUrl: string, businessId: string, section?: string) {
  await page.goto(`${webUrl}/provider/${businessId}${section ? `/${section}` : ''}`);
  await page.getByRole('heading', { name: section ? SECTION_TITLES[section] : 'Business settings', exact: true }).filter({ visible: true }).waitFor();
}
const SECTION_TITLES: Record<string, string> = { profile: 'Business details', services: 'Services', hours: 'Business hours', staff: 'Staff and assignments', policy: 'Booking policy', publish: 'Publish your business', share: 'Share your business' };
const hubUrl = (businessId: string) => (url: URL) => url.pathname === `/provider/${businessId}`;
async function openFromHub(page: Page, section: string) {
  await page.getByTestId(`setup-guide-${section}`).filter({ visible: true }).click();
  await page.getByRole('heading', { name: SECTION_TITLES[section], exact: true }).filter({ visible: true }).waitFor();
}
async function backToHub(page: Page, businessId: string) {
  await page.getByTestId('setup-back').filter({ visible: true }).click(); await page.waitForURL(hubUrl(businessId));
}
const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Summary times sit in Unicode isolates so they read left to right in Hebrew; compare without them. */
export async function summaryText(scope: Page | Locator, testID: string) { return (await scope.getByTestId(testID).filter({ visible: true }).textContent())?.replace(/[\u2066-\u2069]/g, ''); }
/** Opens the hours dialog, sets the given days to 09:00–17:00 or closed, and saves; the dialog saves on its own. */
async function saveHours(page: Page, url: string, { days, closed, screenshot }: { days: string[]; closed: boolean; screenshot?: string }) {
  await page.getByRole('button', { name: 'Edit hours', exact: true }).filter({ visible: true }).click();
  const dialog = page.getByTestId('hours-form'); await page.getByRole('dialog').waitFor();
  for (const day of days) await dialog.getByRole('checkbox', { name: day, exact: true }).click();
  const closedSwitch = dialog.getByRole('switch', { name: 'Closed on these days', exact: true });
  if (await closedSwitch.isChecked() !== closed) await closedSwitch.click();
  if (!closed) { await dialog.getByRole('textbox', { name: 'Opening time 1', exact: true }).fill('09:00'); await dialog.getByRole('textbox', { name: 'Closing time 1', exact: true }).fill('17:00'); }
  if (screenshot) await page.screenshot({ path: `test-results/${screenshot}.png` });
  const saved = page.waitForResponse(r => r.url() === url && r.request().method() === 'PUT');
  await dialog.getByRole('button', { name: 'Save hours', exact: true }).click(); assert.equal((await saved).status(), 200);
  await dialog.waitFor({ state: 'detached' }); await page.getByRole('status').filter({ hasText: 'Hours saved.' }).filter({ visible: true }).waitFor();
}
export async function configureBusinessSmoke({ page, context, webUrl, apiUrl, businessId }: { page: Page; context: BrowserContext; webUrl: string; apiUrl: string; businessId: string }) {
  const base = `${apiUrl}/v1/provider/businesses/${businessId}`;
  await openSettings(page, webUrl, businessId); await openFromHub(page, 'profile');
  await page.getByRole('textbox', { name: 'Location', exact: true }).fill('Jerusalem');
  await page.getByRole('textbox', { name: 'Category', exact: true }).fill('Wellness');
  await page.getByRole('textbox', { name: 'About your business', exact: true }).fill('A real setup flow with saved public details.');
  await page.getByRole('textbox', { name: 'Public business phone', exact: true }).fill('+972501234567');
  await page.getByRole('textbox', { name: 'Public business email', exact: true }).fill('public-studio@example.test');
  let failProfile = true;
  await page.route(base, route => route.request().method() === 'PATCH' && failProfile ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE"}}' }) : route.continue());
  await page.getByRole('button', { name: 'Save business details', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Could not save.' }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Location', exact: true }).inputValue(), 'Jerusalem');
  failProfile = false;
  const profileSaved = page.waitForResponse(r => r.url() === base && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save business details', exact: true }).click(); assert.equal((await profileSaved).status(), 200);
  // A single-form section returns to the hub, whose status is already current.
  await page.waitForURL(hubUrl(businessId)); await page.getByRole('button', { name: 'Business details, Complete', exact: true }).filter({ visible: true }).waitFor();
  await openFromHub(page, 'services');
  // The form opens only from the header's add button, and has no currency field: new prices are ILS.
  await page.getByTestId('service-add').filter({ visible: true }).click();
  const form = page.getByTestId('service-form');
  await form.getByRole('textbox', { name: 'Service name', exact: true }).fill(SETUP_SERVICE.name);
  await form.getByRole('textbox', { name: 'Duration in minutes', exact: true }).fill(String(SETUP_SERVICE.durationMinutes));
  await form.getByRole('textbox', { name: 'Price', exact: true }).fill(String(SETUP_SERVICE.price));
  const serviceCreated = page.waitForResponse(r => r.url() === `${base}/services` && r.request().method() === 'POST');
  await form.getByRole('button', { name: 'Add service', exact: true }).click(); const response = await serviceCreated; assert.equal(response.status(), 201); const created = await response.json(); const serviceId = created.id;
  assert.equal(created.currency, SETUP_SERVICE.currency);
  await form.waitFor({ state: 'detached' });
  // Services is a list: saving one keeps the owner there to add the next.
  assert.equal(new URL(page.url()).pathname, `/provider/${businessId}/services`);
  await backToHub(page, businessId); await openFromHub(page, 'staff');
  // The add form opens only from the header button, in a dialog.
  await page.getByText('No staff members yet.', { exact: true }).filter({ visible: true }).waitFor();
  await page.getByTestId('staff-add').filter({ visible: true }).click();
  const addForm = page.getByTestId('staff-add-form'); await page.getByRole('dialog').waitFor();
  await addForm.getByRole('textbox', { name: 'Name', exact: true }).fill('Pilot expert');
  // Capacity takes digits only: the letters never reach the field.
  await addForm.getByRole('textbox', { name: 'Simultaneous appointments', exact: true }).fill('');
  await addForm.getByRole('textbox', { name: 'Simultaneous appointments', exact: true }).pressSequentially('x2y');
  assert.equal(await addForm.getByRole('textbox', { name: 'Simultaneous appointments', exact: true }).inputValue(), '2');
  await addForm.getByRole('checkbox', { name: SETUP_SERVICE.name, exact: true }).click();
  let lostAcknowledgement = true, firstStaffId = '';
  await page.route(`${base}/staff`, async route => {
    if (route.request().method() === 'POST' && lostAcknowledgement) { lostAcknowledgement = false; const created = await route.fetch(); assert.equal(created.status(), 201); firstStaffId = (await created.json()).id; await route.abort(); } else await route.continue();
  });
  await addForm.getByRole('button', { name: 'Add staff member', exact: true }).click(); await addForm.getByRole('alert').filter({ hasText: 'Could not save.' }).waitFor();
  const staffCreated = page.waitForResponse(r => r.url() === `${base}/staff` && r.request().method() === 'POST');
  await addForm.getByRole('button', { name: 'Add staff member', exact: true }).click(); const staffResponse = await staffCreated; assert.equal(staffResponse.status(), 201); const staffId = (await staffResponse.json()).id; assert.equal(staffId, firstStaffId);
  await addForm.waitFor({ state: 'detached' });
  const staff = page.getByTestId(`staff-card-${staffId}`); await staff.waitFor();
  await staff.getByText(SETUP_SERVICE.name, { exact: true }).waitFor();
  await staff.getByRole('button', { name: 'Edit Pilot expert', exact: true }).click();
  await staff.getByRole('tab', { name: 'General', exact: true }).waitFor();
  await staff.getByRole('textbox', { name: 'Name', exact: true }).fill(SETUP_STAFF_NAME);
  const staffSaved = page.waitForResponse(r => r.url() === `${base}/staff/${staffId}` && r.request().method() === 'PATCH');
  await staff.getByRole('button', { name: 'Save changes', exact: true }).click(); assert.equal((await staffSaved).status(), 200);
  await staff.getByRole('status').filter({ hasText: 'Changes saved.' }).waitFor();
  const staffRules = `${base}/staff/${staffId}/availability-rules`;
  // Staff hours start from the business hours; with none set yet, the staff member follows an empty week.
  await staff.getByRole('tab', { name: 'Hours', exact: true }).click();
  await staff.getByText('Follows the business hours.', { exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/business-staff-hours-en-mobile.png', fullPage: true });
  await saveHours(page, staffRules, { days: WEEK, closed: false });
  assert.equal(await summaryText(staff, 'hours-group-0-1-2-3-4-5-6'), 'Sun, Mon, Tue, Wed, Thu, Fri, Sat: 09:00–17:00');
  const followed = page.waitForResponse(r => r.url() === staffRules && r.request().method() === 'PUT');
  await staff.getByRole('button', { name: 'Follow business hours', exact: true }).click(); assert.equal((await followed).status(), 200);
  await staff.getByText('Follows the business hours.', { exact: true }).waitFor();
  // Removing someone who never had a booking deletes them; the pilot staff member stays the only one.
  await page.getByTestId('staff-add').filter({ visible: true }).click();
  await addForm.getByRole('textbox', { name: 'Name', exact: true }).fill('Temporary helper');
  await addForm.getByRole('checkbox', { name: SETUP_SERVICE.name, exact: true }).click();
  const tempCreated = page.waitForResponse(r => r.url() === `${base}/staff` && r.request().method() === 'POST');
  await addForm.getByRole('button', { name: 'Add staff member', exact: true }).click(); const tempId = (await (await tempCreated).json()).id;
  const temp = page.getByTestId(`staff-card-${tempId}`); await temp.waitFor();
  await temp.getByRole('button', { name: 'Remove Temporary helper', exact: true }).click();
  const removed = page.waitForResponse(r => r.url() === `${base}/staff/${tempId}` && r.request().method() === 'DELETE');
  await temp.getByRole('button', { name: 'Confirm', exact: true }).click(); assert.deepEqual(await (await removed).json(), { deleted: true, archived: false });
  await temp.waitFor({ state: 'detached' }); await page.getByRole('status').filter({ hasText: 'Staff member removed.' }).filter({ visible: true }).waitFor();
  await page.screenshot({ path: 'test-results/business-staff-en-mobile.png', fullPage: true });
  assert.equal(new URL(page.url()).pathname, `/provider/${businessId}/staff`, 'staff hours save in place');
  await backToHub(page, businessId); await openFromHub(page, 'hours');
  await page.getByText('No hours set yet. Customers cannot book until you add them.', { exact: true }).filter({ visible: true }).waitFor();
  await page.getByRole('button', { name: 'Edit hours', exact: true }).filter({ visible: true }).click();
  const dialog = page.getByTestId('hours-form');
  await dialog.getByRole('button', { name: 'Save hours', exact: true }).click(); await dialog.getByText('Choose at least one day.', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  await saveHours(page, `${base}/availability-rules`, { days: WEEK, closed: false, screenshot: 'business-hours-dialog-en-mobile' });
  // Hours stay on their screen after saving, so several day groups can be edited in a row (decisions.md, 2026-11-02).
  assert.equal(await summaryText(page, 'hours-group-0-1-2-3-4-5-6'), 'Sun, Mon, Tue, Wed, Thu, Fri, Sat: 09:00–17:00');
  assert.equal(new URL(page.url()).pathname, `/provider/${businessId}/hours`, 'business hours save in place');
  await page.screenshot({ path: 'test-results/business-hours-en-mobile.png', fullPage: true });
  // Downstream journeys need exactly one date the only staff member does not work: a whole-day block with a reason.
  const closedDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), blocksUrl = `${apiUrl}/api/provider/block-time`;
  await page.getByTestId('time-blocks-empty').filter({ visible: true }).waitFor();
  await page.getByTestId('block-add').filter({ visible: true }).click();
  const blockForm = page.getByTestId('block-form'); await page.getByRole('dialog').waitFor();
  await blockForm.getByRole('radio', { name: SETUP_STAFF_NAME, exact: true }).click();
  await blockForm.getByRole('radio', { name: 'Whole days', exact: true }).click();
  await blockForm.getByRole('textbox', { name: 'First day', exact: true }).fill(closedDate);
  await blockForm.getByRole('textbox', { name: 'Last day', exact: true }).fill('2020-01-01');
  await blockForm.getByRole('button', { name: 'Save block', exact: true }).click(); await blockForm.getByText('The last day cannot come before the first day.', { exact: true }).waitFor();
  await blockForm.getByRole('textbox', { name: 'Last day', exact: true }).fill(closedDate);
  await blockForm.getByRole('textbox', { name: 'Reason (optional)', exact: true }).fill('Day off');
  await page.screenshot({ path: 'test-results/business-block-dialog-en-mobile.png' });
  const blocked = page.waitForResponse(r => r.url() === blocksUrl && r.request().method() === 'POST');
  await blockForm.getByRole('button', { name: 'Save block', exact: true }).click(); assert.equal((await blocked).status(), 201);
  await blockForm.waitFor({ state: 'detached' }); await page.getByRole('status').filter({ hasText: 'Time blocked.' }).filter({ visible: true }).waitFor();
  await page.getByText(`${SETUP_STAFF_NAME} · Day off`, { exact: true }).filter({ visible: true }).waitFor();
  const stored = await (await context.request.get(`${blocksUrl}?businessId=${businessId}`)).json() as { blocks: { staff: { id: string } | null; allDay: boolean; fromDate: string; toDate: string }[] };
  assert.deepEqual(stored.blocks.map(row => [row.staff?.id, row.allDay, row.fromDate, row.toDate]), [[staffId, true, closedDate, closedDate]], 'one staff day off, as booking journeys expect');
  await page.screenshot({ path: 'test-results/business-blocks-en-mobile.png', fullPage: true });
  await backToHub(page, businessId); await openFromHub(page, 'policy');
  await page.getByRole('textbox', { name: 'Latest booking before start (minutes)', exact: true }).fill('0');
  await page.getByRole('textbox', { name: 'How far ahead customers can book (days)', exact: true }).fill('30');
  // Cutoffs are typed in hours; the API keeps minutes.
  assert.equal(await page.getByRole('textbox', { name: 'Cancellation cutoff (hours before)', exact: true }).inputValue(), '24');
  await page.getByRole('textbox', { name: 'Reschedule cutoff (hours before)', exact: true }).fill('2');
  await page.getByText('The calendar is open for booking 30 days ahead.', { exact: true }).waitFor();
  const policySaved = page.waitForResponse(r => r.url() === `${base}/booking-policy` && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save booking policy', exact: true }).click(); const savedPolicy = await policySaved; assert.equal(savedPolicy.status(), 200);
  assert.deepEqual([savedPolicy.request().postDataJSON().cancellationCutoffMinutes, savedPolicy.request().postDataJSON().rescheduleCutoffMinutes], [24 * 60, 2 * 60]);
  await page.waitForURL(hubUrl(businessId)); await page.getByRole('button', { name: 'Publish your business, Needs attention', exact: true }).filter({ visible: true }).waitFor();
  await openSettings(page, webUrl, businessId, 'share');
  assert.equal(await page.getByRole('button', { name: 'Copy booking link', exact: true }).isDisabled(), true);
  await openSettings(page, webUrl, businessId, 'profile');
  assert.equal(await page.getByRole('textbox', { name: 'Public business email', exact: true }).inputValue(), 'public-studio@example.test');
  assert.equal(await page.getByTestId('business-timezone').textContent(), translate('en', 'time.israel'));
  assert.equal((await (await context.request.get(`${base}/staff`)).json()).staff.length, 1);
  // Callers publish next, from the last settings step.
  await openSettings(page, webUrl, businessId); await openFromHub(page, 'publish');
  return { serviceId, staffId, closedDate };
}
export async function sharingBusinessSmoke({ page, context, webUrl, apiUrl, businessId, slug }: { page: Page; context: BrowserContext; webUrl: string; apiUrl: string; businessId: string; slug: string }) {
  // Sharing opens from the agenda once the business is published.
  await page.goto(`${webUrl}/provider/dashboard?businessId=${businessId}`); await page.getByTestId('dashboard-share').filter({ visible: true }).click();
  await page.getByRole('heading', { name: SECTION_TITLES.share, exact: true }).filter({ visible: true }).waitFor();
  const url = `${webUrl}/p/${slug}`;
  await page.getByTestId('provider-sharing-url').waitFor(); assert.equal(await page.getByTestId('provider-sharing-url').textContent(), url);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: webUrl });
  await page.getByRole('button', { name: 'Copy booking link', exact: true }).click(); await page.getByText('Booking link copied.', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), url);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download / share QR code', exact: true }).click();
  const download = await downloading, file = await download.path(); assert.ok(file); const svg = await readFile(file, 'utf8');
  const size = Number(svg.match(/viewBox="0 0 (\d+) /)?.[1]), path = svg.match(/<path d="([^"]+)"/)?.[1]; assert.ok(size && path);
  const scale = 8, width = size * scale, pixels = new Uint8ClampedArray(width * width * 4); pixels.fill(255);
  for (const m of path.matchAll(/M(\d+),(\d+)h1v1h-1z/g)) for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) { const i = ((Number(m[2]) * scale + y) * width + Number(m[1]) * scale + x) * 4; pixels[i] = pixels[i + 1] = pixels[i + 2] = 0; }
  assert.equal(jsQR(pixels, width, width)?.data, url);
  await page.screenshot({ path: 'test-results/provider-sharing-en-mobile.png', fullPage: true });
  assert.equal((await context.request.get(`${apiUrl}/api/provider-links/${slug}`)).status(), 200);
  const browser = context.browser(); assert.ok(browser);
  const fresh = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    await fresh.addCookies(await context.cookies());
    const review = await fresh.newPage(); await review.goto(`${webUrl}/provider/${businessId}/profile`);
    await review.getByRole('heading', { name: 'פרטי העסק', exact: true }).filter({ visible: true }).waitFor();
    assert.equal(await review.getByRole('textbox', { name: 'דואר אלקטרוני ציבורי של העסק', exact: true }).inputValue(), 'public-studio@example.test');
    assert.equal(await review.getByRole('textbox', { name: 'טלפון ציבורי של העסק', exact: true }).evaluate(el => getComputedStyle(el).direction), 'ltr');
    await review.goto(`${webUrl}/provider/${businessId}/staff`); await review.getByRole('heading', { name: 'אנשי הצוות', exact: true }).filter({ visible: true }).waitFor();
    await review.getByRole('button', { name: `עריכה: ${SETUP_STAFF_NAME}`, exact: true }).click(); await review.getByRole('tab', { name: 'כללי', exact: true }).waitFor();
    await review.screenshot({ path: 'test-results/business-staff-he-desktop.png', fullPage: true });
    await review.setViewportSize({ width: 390, height: 844 }); await review.screenshot({ path: 'test-results/business-staff-he-mobile.png', fullPage: true });
    await review.setViewportSize({ width: 1280, height: 900 });
    await review.goto(`${webUrl}/provider/${businessId}/share`); await review.getByTestId('provider-sharing-qr').waitFor();
    await review.screenshot({ path: 'test-results/business-setup-he-desktop.png', fullPage: true });
    await review.setViewportSize({ width: 390, height: 844 }); await review.screenshot({ path: 'test-results/business-setup-he-mobile.png', fullPage: true });
  } finally { await fresh.close(); }
  console.log('PASS: clean approved business configures profile/catalog/staff (add, edit, hours tab, removal)/weekly hours/policy through UI, survives a lost creation acknowledgement without duplicates, publishes and exports an independently decoded canonical QR.');
}
