import { useSessionStore } from '../state/session';
import { emptyManualDraft, useManualDraft } from '../state/ManualBooking.store';
import { manualDraftScope } from './ManualBooking.utils';
import { apiRequest } from './api';
import type { ManualInput, ManualOptions, ManualResult } from '../types/ManualBooking.types';
const root = (id: string) => `/v1/provider/businesses/${encodeURIComponent(id)}`;
export function readManualOptions(businessId: string, signal?: AbortSignal) { return apiRequest<ManualOptions>(root(businessId) + '/manual-booking-options', { signal }); }
export function submitManualBooking(businessId: string, input: ManualInput, identity: string) { return apiRequest<ManualResult>(root(businessId) + '/manual-bookings', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Visit-Expected-Identity': identity }, body: JSON.stringify(input) }); }
/** Opens the form from outside the agenda. Selecting first matters: selecting a business clears the drafts, which after a reload on Account would close the form again. */
export function openManualBooking(businessId: string) {
  const session = useSessionStore.getState();
  if (!session.profile?.businesses.some(business => business.id === businessId)) return;
  session.selectBusiness(businessId);
  const { identityId, contextVersion } = useSessionStore.getState();
  const scope = manualDraftScope(identityId, contextVersion, businessId), manual = useManualDraft.getState();
  // A form in progress stays as it is; after a saved appointment, or when closed, the next one starts empty.
  if (manual.scope === scope && manual.draft.open && !manual.result) return;
  manual.update(scope, { ...emptyManualDraft, open: true });
}
