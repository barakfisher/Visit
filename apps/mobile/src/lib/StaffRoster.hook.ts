import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api';
import { appointmentDate, appointmentTime } from './appointmentTime';
import { useAppLocale } from '../i18n/LocaleContext';
import type { MessageKey } from '../i18n/messages';
import { useSessionStore } from '../state/session';
import type { AccountNavigation } from './navigation';
import { emptyStaffDraft, selfStaffDraft, isCapacityInUse, staffDraft, staffInput, staffRemovalConflicts, validateStaffDraft, type RosterService, type RosterStaff, type StaffDraft, type StaffDraftErrors, type StaffRemovalConflicts } from './StaffRoster';

export type StaffTab = 'general' | 'hours';
type Action = { kind: 'add' } | { kind: 'edit'; id: string } | { kind: 'remove'; id: string };

/** `newKey` makes each add attempt's idempotency key; the screen passes expo-crypto's, which Storybook cannot bundle. */
export function useStaffRoster(businessId: string, newKey: () => string) {
  const { t, locale, direction } = useAppLocale();
  const client = useQueryClient();
  const base = `/v1/provider/businesses/${encodeURIComponent(businessId)}`;
  const staff = useQuery({ queryKey: ['provider', businessId, 'staff'], queryFn: () => apiRequest<{ staff: RosterStaff[] }>(`${base}/staff`) });
  const services = useQuery({ queryKey: ['provider', businessId, 'services'], queryFn: () => apiRequest<{ services: RosterService[] }>(`${base}/services`) });
  const assignable = services.data?.services.filter(service => service.active) ?? [];
  // Same query key as the header; only the account's own name is used, to prefill "Add myself".
  const identity = useSessionStore(state => state.identityId);
  const account = useQuery({ queryKey: ['me', identity], queryFn: () => apiRequest<AccountNavigation>('/v1/me'), enabled: !!identity });
  const canAddSelf = staff.isSuccess && services.isSuccess && !staff.data.staff.length && assignable.length > 0;
  // One draft serves whichever form is open: the add dialog or one card's "General" tab.
  const [addOpen, setAddOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<StaffTab>('general');
  const [draft, setDraft] = useState<StaffDraft>(emptyStaffDraft);
  const [errors, setErrors] = useState<StaffDraftErrors>({});
  const [formError, setFormError] = useState<MessageKey | ''>('');
  const [saved, setSaved] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<StaffRemovalConflicts | null>(null);
  // `message` reports a finished add or removal under the list.
  const [message, setMessage] = useState<MessageKey | ''>('');
  // One key per add attempt, so a retried request after a lost response cannot create the person twice.
  const creationKey = useRef<string | null>(null);
  const mutation = useMutation({
    mutationFn: (action: Action) => {
      if (action.kind === 'remove') return apiRequest<{ deleted: boolean; archived: boolean }>(`${base}/staff/${encodeURIComponent(action.id)}`, { method: 'DELETE' });
      creationKey.current ??= newKey();
      const body = { ...staffInput(draft, action.kind === 'edit'), ...(action.kind === 'add' ? { creationKey: creationKey.current } : {}) };
      return apiRequest(action.kind === 'edit' ? `${base}/staff/${encodeURIComponent(action.id)}` : `${base}/staff`, { method: action.kind === 'edit' ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    },
    onSuccess: async (result, action) => {
      if (action.kind === 'add') { closeAdd(); setMessage('roster.added'); }
      else if (action.kind === 'edit') setSaved(true);
      else { setRemoving(null); setExpanded(current => current === action.id ? null : current); setMessage((result as { archived?: boolean }).archived ? 'roster.archived' : 'roster.removed'); }
      // Agendas, slots and the services screen's staff choices all depend on staff.
      await client.invalidateQueries({ predicate: query => ['provider', 'providers', 'public', 'availability', 'slots', 'provider-detail'].includes(String(query.queryKey[0])) });
    },
    onError: (error, action) => {
      if (action.kind === 'remove') {
        const listed = staffRemovalConflicts(error);
        if (listed) setConflicts(listed); else setMessage('roster.removeFailed');
        return;
      }
      if (isCapacityInUse(error)) { setErrors({ capacity: 'capacityInUse' }); return; }
      setFormError('roster.saveFailed');
    },
  });
  const busy = mutation.isPending;
  function resetForm(next: StaffDraft) { setDraft(next); setErrors({}); setFormError(''); setSaved(false); }
  function closeAdd() { setAddOpen(false); resetForm(emptyStaffDraft()); creationKey.current = null; }
  function openAdd(draft = emptyStaffDraft()) { resetForm(draft); creationKey.current = null; setExpanded(null); setRemoving(null); setConflicts(null); setMessage(''); setAddOpen(true); }
  /** A pending save keeps the form open, so its result always lands where the owner is looking. */
  function cancelAdd() { if (!busy) closeAdd(); }
  /** "Edit" opens one card's section on "General" with that card's saved values; pressing it again collapses it. */
  function toggleEdit(row: RosterStaff) {
    if (busy) return;
    setRemoving(null); setConflicts(null); setMessage('');
    if (expanded === row.id) { setExpanded(null); return; }
    resetForm(staffDraft(row, assignable)); setTab('general'); setExpanded(row.id);
  }
  function cancelEdit() { if (!busy) setExpanded(null); }
  function update(patch: Partial<StaffDraft>) { setDraft(current => ({ ...current, ...patch })); setErrors({}); setFormError(''); setSaved(false); }
  function toggleService(id: string) { setDraft(current => ({ ...current, serviceIds: current.serviceIds.includes(id) ? current.serviceIds.filter(item => item !== id) : [...current.serviceIds, id] })); setErrors({}); setFormError(''); setSaved(false); }
  function save() {
    const found = validateStaffDraft(draft);
    setErrors(found); setFormError(''); setSaved(false);
    if (Object.keys(found).length) return;
    mutation.mutate(expanded ? { kind: 'edit', id: expanded } : { kind: 'add' });
  }
  function askRemove(id: string | null) { if (!busy) { setRemoving(id); setConflicts(null); setMessage(''); } }
  function confirmRemove(id: string) { setConflicts(null); mutation.mutate({ kind: 'remove', id }); }
  const pending = busy ? mutation.variables : undefined;
  return {
    t, locale, direction, businessId, staff, services, assignable, addOpen, expanded, tab, draft, errors, formError, saved, removing, conflicts, message, busy,
    removingPending: pending?.kind === 'remove' ? pending.id : null,
    canAddSelf, openAdd: () => openAdd(), openAddSelf: () => openAdd(selfStaffDraft(account.data?.identity.displayName, assignable)), cancelAdd, toggleEdit, cancelEdit, setTab, update, toggleService, save, askRemove, confirmRemove,
    when: (instant: string) => conflicts?.timezone ? `${appointmentDate(instant, conflicts.timezone, locale)} · ${appointmentTime(instant, conflicts.timezone, locale)}` : '',
  };
}
export type StaffRosterState = ReturnType<typeof useStaffRoster>;
