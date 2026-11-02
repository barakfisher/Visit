import { WeeklyHours } from '../WeeklyHours';
import { useWeeklyHours } from '@/src/lib/WeeklyHours.hook';
import { useSessionStore } from '@/src/state/session';
/** Remounting on a new identity, session context, business or staff member drops any open draft from the previous one. */
export function AvailabilityEditor({ businessId, staffId }: { businessId: string; staffId?: string }) {
  const identity = useSessionStore(state => state.identityId), version = useSessionStore(state => state.contextVersion);
  return <Hours key={JSON.stringify([identity, version, businessId, staffId])} businessId={businessId} staffId={staffId} />;
}
function Hours({ businessId, staffId }: { businessId: string; staffId?: string }) { return <WeeklyHours {...useWeeklyHours(businessId, staffId)} />; }
