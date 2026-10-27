export function upcomingStartDelay(startsAt: string, now: number): number | null {
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return null;
  return Math.max(1, Math.min(start - now + 1, 2147483647));
}
