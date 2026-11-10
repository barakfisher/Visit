import type { Page } from 'playwright';
import { BOOKING_PAGE_SIZE } from '../src/lib/CompactBooking.utils';
export async function selectBookingDate(page: Page, date: string) {
  await page.getByTestId('booking-date-trigger').filter({ visible: true }).click();
  for (let count = 0; count < 26; count++) {
    const month = await page.getByTestId('booking-calendar-month').getAttribute('aria-label');
    if (month === date.slice(0, 7)) break;
    await page.getByRole('button', { name: month && month < date.slice(0, 7) ? 'Next month' : 'Previous month', exact: true }).click();
  }
  await page.getByTestId(`booking-day-${date}`).click();
  await page.getByRole('dialog', { name: 'Choose a date', exact: true }).waitFor({ state: 'hidden' });
}
export async function selectedBookingDate(page: Page) { return (await page.getByTestId('booking-date-trigger').filter({ visible: true }).getAttribute('aria-label'))?.match(/\d{4}-\d{2}-\d{2}$/)?.[0] ?? null; }
/** How many times a page of them settles on. Times that left stay in the page until their fade-out ends, so counting straight after a change sees both pages. */
export async function settledTimeCount(page: Page, name: RegExp, expected: number) {
  const times = page.getByRole('button', { name });
  await times.nth(expected).waitFor({ state: 'detached' });
  return times.count();
}
/** Rewinds to the first group of six, then pages Later until a time at `time` (or a time whose name matches) is on screen; the booking screen has no field for a preferred time. */
export async function showBookingTime(page: Page, time: string | RegExp) {
  const name = typeof time === 'string' ? new RegExp(`(^|[^\\d])${time.replace(':', '\\:')}(?!\\d)`) : time;
  const target = page.getByRole('button', { name }).filter({ visible: true });
  const summary = page.getByTestId('booking-page-summary').filter({ visible: true });
  const chips = page.locator('[data-testid="booking-time-chips"] [aria-pressed]');
  const earlier = page.getByTestId('booking-earlier').filter({ visible: true }), later = page.getByTestId('booking-later').filter({ visible: true });
  // Start from the first group: Later taps made while a just-chosen date was still showing older times would leave the offset elsewhere.
  await summary.waitFor();
  const turn = async (button: typeof later) => {
    const before = await summary.textContent();
    await button.click();
    await page.waitForFunction(([text]) => document.querySelector('[data-testid="booking-page-summary"]')?.textContent !== text, [before]);
    // The old group stays in the page, over the new one, until its fade-out ends; a click before that lands on a leaving time.
    await chips.nth(BOOKING_PAGE_SIZE).waitFor({ state: 'detached' });
  };
  for (let pages = 0; pages < 50 && await earlier.getAttribute('aria-disabled') !== 'true'; pages++) await turn(earlier);
  for (let pages = 0; pages < 50; pages++) {
    // The summary can render before its times do; checking then would page past the group that holds the time.
    await chips.first().waitFor();
    if (await target.count()) return;
    if (await later.getAttribute('aria-disabled') === 'true') break;
    await turn(later);
  }
  // The last group may still be fading in; if the time never comes, say what was offered instead.
  await target.first().waitFor({ timeout: 5000 }).catch(async () => {
    const shown = await chips.allTextContents();
    throw new Error(`time ${time} not offered; ${await summary.textContent()}: ${shown.join(', ')}`);
  });
}
