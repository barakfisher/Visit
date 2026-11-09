export function upcomingStartDelay(startsAt: string, now: number): number | null {
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return null;
  return Math.max(1, Math.min(start - now + 1, 2147483647));
}

type CardRead = { visible: boolean; isPending: boolean; isError: boolean; isFetching: boolean; hasBooking: boolean };

/** A background re-read keeps the card on screen. The loading text is for a first read and for retrying after an error. */
export function upcomingCardState({ visible, isPending, isError, isFetching, hasBooking }: CardRead) {
  if (!visible) return 'hidden' as const;
  if (isPending || (isError && isFetching)) return 'loading' as const;
  if (isError) return 'error' as const;
  return hasBooking ? 'ready' as const : 'hidden' as const;
}
