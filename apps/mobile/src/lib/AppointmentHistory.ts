// The upcoming list already shows a scheduled appointment with its details and change history, so the history leaves it out.
// History waits for that list, so an appointment never appears there and then vanishes, and shows everything when it failed, so nothing goes missing.
// The latest appointment comes first: it is the one a customer usually looks for.
export type UpcomingListState = { status: 'pending' | 'error' | 'success'; ids: readonly string[] };
export function historyEntries<T extends { id: string; startsAt: string }>(history: readonly T[], upcoming: UpcomingListState): readonly T[] | null {
  if (upcoming.status === 'pending') return null;
  const listed = new Set(upcoming.status === 'error' ? [] : upcoming.ids);
  return history.filter(booking => !listed.has(booking.id)).sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
}
