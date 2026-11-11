import type { Page } from 'playwright';
/** How many months a smoke steps through before it gives up looking for a day. */
const MONTH_STEPS = 24;
/**
 * Dates and times are picked, never typed (decisions.md, 2026-11-11). Opens the picker whose trigger has `testID`,
 * steps forward a month at a time until `date` (YYYY-MM-DD) shows, and taps it.
 */
export async function pickDate(page: Page, testID: string, date: string) {
  await page.getByTestId(testID).click();
  const sheet = page.getByTestId(`${testID}-sheet`), day = sheet.getByTestId(`${testID}-day-${date}`);
  await sheet.waitFor();
  for (let step = 0; step < MONTH_STEPS && !await day.count(); step++) await sheet.getByRole('button', { name: /^(Next month|החודש הבא)$/ }).click();
  await day.click(); await sheet.waitFor({ state: 'detached' });
}
/** Opens the time picker whose trigger has `testID`, taps the hour and the minutes of `time` (HH:mm), and closes it. */
export async function pickTime(page: Page, testID: string, time: string) {
  const [hour, minute] = time.split(':');
  await page.getByTestId(testID).click();
  const sheet = page.getByTestId(`${testID}-sheet`); await sheet.waitFor();
  await sheet.getByTestId(`${testID}-hour-${hour}`).click(); await sheet.getByTestId(`${testID}-minute-${minute}`).click();
  await sheet.getByTestId(`${testID}-done`).click(); await sheet.waitFor({ state: 'detached' });
}
