/**
 * Where the signed-in member may act in the business shown, as the agenda reports it (decisions.md, "Switches"):
 * every calendar (`all`), their own linked row (`staffId`), or nowhere (null). "See" and "act" are separate
 * switches, so the agenda may show calendars whose appointments, free time and blocks this member cannot change.
 * Screens offer only what this allows; the server checks every write again.
 */
export type ActingScope = { all: boolean; staffId: string | null } | null;

/** Whether this member may add, move, cancel, block or mark outcomes on the given row. */
export const actsOn = (act: ActingScope | undefined, staffId: string | null | undefined) => !!act && (act.all || (!!staffId && act.staffId === staffId));

/** The calendar a new block is pinned to: the member's own when it is the only one they act on. */
export const pinnedCalendar = (act: ActingScope | undefined) => act && !act.all ? act.staffId ?? undefined : undefined;

/** The rows a block may name: every row for someone acting on all, else only their own. */
export const blockableStaff = <T extends { id: string }>(act: ActingScope | undefined, staff: readonly T[]) => !act ? [] : act.all ? staff : staff.filter(row => row.id === act.staffId);

/**
 * A business-wide block closes the business, which is setup (decisions.md, "My day for a worker"). Without it the
 * block names a row, and the first the member may block is chosen to start with.
 */
export const blockStart = (setup: boolean, staff: readonly { id: string }[]) => setup ? undefined : staff[0]?.id;
