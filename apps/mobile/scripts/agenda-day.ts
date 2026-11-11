import type { Locator, Page } from 'playwright';
/**
 * The business home shows today only (decisions.md, "The business home shows today" — 2026-11-10), so a smoke that
 * looks at another day's appointments sets the page's clock to a moment of that day and opens the home.
 * The clock is fixed for this page from then on, including later navigations; timers still run.
 */
export async function showAgendaAt(page: Page, url: string, instant: string) {
  await page.clock.setFixedTime(new Date(instant));
  await page.goto(url);
}
/** Unfolds an appointment card on the home, where its contact, actions and change history wait behind a tap. */
export async function unfoldAgendaCard(page: Page, card: Locator) {
  const id = await card.getAttribute('data-testid');
  const toggle = page.getByTestId(`${id}-toggle`);
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.getByTestId(`${id}-details`).waitFor();
  // Unfolded means seen, not only rendered: no clipping ancestor may cut the details off, as a clip measured at the
  // card's folded height would (the "Ended today" list once did).
  await page.waitForFunction(detailsId => {
    const details = document.querySelector(`[data-testid="${detailsId}"]`); if (!details) return false;
    const { top, bottom } = details.getBoundingClientRect(); if (bottom - top < 1) return false;
    for (let node = details.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      if (node !== document.body && style.overflowY !== 'visible' && style.overflowY !== 'auto' && style.overflowY !== 'scroll' && rect.bottom < bottom - 1) return false;
    }
    return true;
  }, `${id}-details`);
}
/** Opens the row of appointments that ended today, folded by default. */
export async function unfoldEndedToday(page: Page) {
  const toggle = page.getByTestId('agenda-ended-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  await page.getByTestId('agenda-ended').waitFor();
}
