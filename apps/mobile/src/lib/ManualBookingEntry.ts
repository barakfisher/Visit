import { useSessionStore } from '../state/session';
import { emptyManualDraft, useManualDraft } from '../state/ManualBooking.store';
import { manualDraftScope } from './ManualBooking.utils';
/**
 * Opens the Add appointment sheet over the business home (decisions.md, 2026-11-11). Selecting first matters: selecting a business clears the drafts, which after a reload on Account would close the form again. A new form starts today.
 * `start` comes from a free-time card on the business home: it sets the date, time and staff member, and keeps anything else already typed.
 */
export function openManualBooking(businessId: string, start?: { localDate: string; localTime: string; staffId?: string }) {
  const session = useSessionStore.getState();
  if (!session.profile?.businesses.some(business => business.id === businessId)) return;
  session.selectBusiness(businessId);
  const { identityId, contextVersion } = useSessionStore.getState();
  const scope = manualDraftScope(identityId, contextVersion, businessId), manual = useManualDraft.getState();
  // A form in progress stays as it is; after a saved appointment, or when closed, the next one starts empty.
  if (manual.scope === scope && manual.draft.open && !manual.result) { if (start) manual.update(scope, { ...start, utcOffset: '', reviewed: false }); return; }
  manual.update(scope, { ...emptyManualDraft, open: true, ...start });
}
