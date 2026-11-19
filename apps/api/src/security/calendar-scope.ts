import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/client.js';
import { AppError, forbidden } from '../http/errors.js';
import { BusinessPermission, permissionWhere } from './business-permissions.js';
import { countedMembershipWhere, requireBusinessPermission, type AuthorizedBusinessContext } from './tenant-context.js';

/**
 * Which calendars a member works on in one business (worker-access.md, slice 3). `staffId: null` is every calendar
 * (the owner and managers); a worker gets only the staff row their membership is linked to. Every agenda, block and
 * appointment path narrows its queries by this, so another row reads as not found, never as data.
 */
export type CalendarScope = Readonly<{ context: AuthorizedBusinessContext; staffId: string | null }>;
/** See: read agendas, blocks and history. Act: add, move, cancel, block and mark outcomes. */
export type CalendarAccess = 'see' | 'act';

const everyCalendar: Record<CalendarAccess, BusinessPermission> = { see: BusinessPermission.SEE_ALL_CALENDARS, act: BusinessPermission.ACT_ON_ALL_CALENDARS };

/** The member's own linked row, if their membership grants their own calendar; null otherwise. */
async function linkedCalendar(identityId: string, businessId: string) {
  const membership = await prisma.membership.findFirst({ where: ownCalendarMembershipWhere(identityId, businessId), select: { staffId: true } });
  return membership?.staffId ?? null;
}

/** The membership row that grants a worker their own calendar, for a check inside a transaction. */
export function ownCalendarMembershipWhere(identityId: string, businessId: string, staffId?: string) {
  return { identityId, businessId, status: 'ACTIVE', staffId: staffId ?? { not: null }, business: { approvalStatus: 'APPROVED', deletedAt: null }, AND: [permissionWhere(BusinessPermission.OWN_CALENDAR), countedMembershipWhere] } satisfies Prisma.MembershipWhereInput;
}

/** Every calendar if the member holds the business-wide permission, else their own linked row, else forbidden. */
export async function requireCalendarScope(identityId: string, businessId: string, access: CalendarAccess): Promise<CalendarScope> {
  const all = await requireBusinessPermission(identityId, businessId, everyCalendar[access]).catch(error => { if (error instanceof AppError && error.statusCode === 403) return null; throw error; });
  if (all) return Object.freeze({ context: all, staffId: null });
  const staffId = await linkedCalendar(identityId, businessId);
  if (!staffId) throw forbidden();
  return Object.freeze({ context: await requireBusinessPermission(identityId, businessId, BusinessPermission.OWN_CALENDAR), staffId });
}

/** Rechecks a scope against the member's current access: a worker relinked or demoted meanwhile is refused. */
export async function validateCalendarScope(scope: CalendarScope, access: CalendarAccess) {
  const current = await requireCalendarScope(scope.context.identityId, scope.context.businessId, access);
  if (current.staffId !== scope.staffId) throw forbidden();
}

/**
 * The membership a write must still find inside its transaction, after locking the member's rows FOR SHARE.
 * For every calendar it is a membership holding the business-wide switch; for a worker, the same linked row.
 */
export function calendarMembershipWhere(scope: CalendarScope, access: CalendarAccess) {
  const { identityId, businessId } = scope.context;
  if (scope.staffId) return ownCalendarMembershipWhere(identityId, businessId, scope.staffId);
  return { identityId, businessId, status: 'ACTIVE', business: { approvalStatus: 'APPROVED', deletedAt: null }, AND: [permissionWhere(everyCalendar[access]), countedMembershipWhere] } satisfies Prisma.MembershipWhereInput;
}

/** Narrows a booking or block query to the scope's row. */
export const onCalendar = (scope: CalendarScope) => scope.staffId ? { staffId: scope.staffId } : {};
/** Blocks a scope sees: its own row's and the business-wide ones that close it too. */
export const blocksSeenBy = (scope: CalendarScope) => scope.staffId ? { OR: [{ staffId: scope.staffId }, { staffId: null }] } : {};
/**
 * Where a member may act, for screens to offer only those actions (decisions.md, "Switches"): every calendar
 * (`all`), their own linked row (`staffId`), or nowhere (null). "See" and "act" are separate switches, so a member may
 * read the whole business and act on their own row only. Every write checks again with `requireCalendarScope`.
 */
export type ActingScope = { all: boolean; staffId: string | null } | null;
export async function actingScope(identityId: string, businessId: string): Promise<ActingScope> {
  try {
    const scope = await requireCalendarScope(identityId, businessId, 'act');
    return { all: scope.staffId === null, staffId: scope.staffId };
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 403) return null;
    throw error;
  }
}
