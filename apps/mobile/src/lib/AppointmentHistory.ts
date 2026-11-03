// The upcoming list already shows a scheduled appointment with its details and change history, so the history leaves it out.
// History waits for that list, so an appointment never appears there and then vanishes, and shows everything when it failed, so nothing goes missing.
export type UpcomingListState = { status: 'pending' | 'error' | 'success'; ids: readonly string[] };
export function historyEntries<T extends { id: string }>(history: readonly T[], upcoming: UpcomingListState): readonly T[] | null {
  if (upcoming.status === 'pending') return null;
  if (upcoming.status === 'error') return history;
  const listed = new Set(upcoming.ids);
  return history.filter(booking => !listed.has(booking.id));
}
