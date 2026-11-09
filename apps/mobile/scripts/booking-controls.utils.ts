import type { Page } from 'playwright';
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
export async function preferBookingTime(page: Page, time: string) { await page.getByTestId('booking-preferred-time').filter({ visible: true }).fill(time); }
