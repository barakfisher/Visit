/** A blocked range as the API presents it: local dates always, local times only for an hours block. */
export type TimeBlock = {
  id: string; startsAt: string; endsAt: string; allDay: boolean; reason: string | null;
  /** Null blocks the whole business. */
  staff: { id: string; displayName: string } | null;
  fromDate: string; toDate: string; startLocal?: string; endLocal?: string;
};
export type TimeBlockList = { timezone: string; blocks: TimeBlock[] };
export type TimeBlockInput = { businessId: string; staffId?: string; reason?: string } & (
  { kind: 'hours'; date: string; startLocal: string; endLocal: string } | { kind: 'days'; fromDate: string; toDate: string }
);
/** A reservation in progress belongs to a customer who has not booked yet, so it has no customer details. */
export type BlockConflict =
  | { kind: 'APPOINTMENT'; id: string; startsAt: string; endsAt: string; staffName: string; customerName: string | null; serviceName: string | null }
  | { kind: 'RESERVATION'; startsAt: string; endsAt: string; staffName: string };
export type BlockConflicts = { total: number; conflicts: BlockConflict[] };
