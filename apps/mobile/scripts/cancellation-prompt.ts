import type { Page } from 'playwright';
import { appointmentCancellationCopy } from '../src/i18n/cancellationConfirm';
import type { Locale } from '../src/i18n/messages';

/**
 * Answers the cancellation sheet the app opens before any cancel, and waits until it has fully left: while it slides
 * away its own "Cancel appointment" button is still on the page, and would match the screen's button by name.
 * Returns the sheet's text, for checks that it spoke the customer's language.
 */
export async function answerCancellation(page: Page, confirm: boolean, locale: Locale = 'en') {
  const sheet = page.getByTestId('cancellation-prompt');
  await sheet.waitFor();
  const text = await sheet.innerText();
  const copy = appointmentCancellationCopy(locale);
  await sheet.getByRole('button', { name: confirm ? copy.cancel : copy.keep, exact: true }).click();
  await page.getByTestId('cancellation-prompt-backdrop').waitFor({ state: 'detached' });
  return text;
}
