import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useAppLocale } from '../i18n/LocaleContext';
import type { MessageKey } from '../i18n/messages';
import { useSessionStore } from '../state/session';
import { apiRequest, ApiError } from './api';
import { canContinueAppointmentAction } from './AppointmentLifecycle.utils';
import { isBookingQuery } from './BookingQueries.utils';
import { appointmentDate, appointmentTime, localDate } from './appointmentTime';
import { createTimeBlock, readTimeBlocks, removeTimeBlock } from './TimeBlocks.service';
import { BLOCK_IN_PAST, blockConflicts, blockInput, emptyBlockForm, validateBlockForm, type BlockForm, type BlockFormErrors } from './TimeBlocks';
import type { BlockConflicts } from '../types/TimeBlocks.types';

/** Results land only in the workspace and screen that started them (`canContinueAppointmentAction`). */
function useCurrentScope(businessId: string) {
  const identity = useSessionStore(state => state.identityId), version = useSessionStore(state => state.contextVersion);
  const focused = useIsFocused(), focusRef = useRef(focused), mounted = useRef(true);
  useEffect(() => { focusRef.current = focused; }, [focused]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return { identity, version, focused, mounted, capture: () => {
    const initial = { identityId: identity, contextVersion: version, activeBusinessId: businessId };
    return () => focusRef.current && canContinueAppointmentAction(initial, useSessionStore.getState(), mounted.current, businessId);
  } };
}

function saveFailure(error: unknown): MessageKey {
  if (error instanceof ApiError && error.code === BLOCK_IN_PAST) return 'blocks.past';
  if (error instanceof ApiError && error.code === 'INVALID_LOCAL_TIME') return 'blocks.invalidTime';
  if (error instanceof ApiError && error.status === 404) return 'blocks.staffGone';
  return 'blocks.saveFailed';
}

/**
 * The "Block time" dialog, shared by the hours screen and the agenda. A refused block lists what it
 * would have covered and keeps the form, so the owner can change it or go and move those appointments.
 */
export function useTimeBlockDialog(businessId: string, timezone: string | undefined, onSaved?: () => void) {
  const { t, locale, direction } = useAppLocale(), client = useQueryClient(), scope = useCurrentScope(businessId);
  const operation = useRef(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<BlockForm>(() => emptyBlockForm(''));
  const [errors, setErrors] = useState<BlockFormErrors>({});
  const [conflicts, setConflicts] = useState<BlockConflicts | null>(null);
  const [failure, setFailure] = useState<MessageKey | ''>('');
  const [busy, setBusy] = useState(false);

  /** A calendar slot passes its time too, and the block starts there. */
  function openDialog(date?: string, startLocal?: string) {
    if (operation.current || !timezone) return;
    setForm(emptyBlockForm(date ?? localDate(timezone), startLocal)); setErrors({}); setConflicts(null); setFailure(''); setOpen(true);
  }
  /** A pending save keeps the dialog open, so its result lands where the owner is looking. */
  function close() { if (!operation.current) setOpen(false); }
  function update(patch: Partial<BlockForm>) { if (!operation.current) { setForm(current => ({ ...current, ...patch })); setErrors({}); setConflicts(null); setFailure(''); } }
  async function submit() {
    if (operation.current || !timezone) return;
    const found = validateBlockForm(form, localDate(timezone));
    setErrors(found); setConflicts(null); setFailure('');
    if (Object.keys(found).length) return;
    operation.current = true; setBusy(true);
    const isCurrent = scope.capture();
    try {
      await createTimeBlock(blockInput(form, businessId, reason => t(`blocks.reason.${reason}`)));
      if (!isCurrent()) return;
      // A block changes slots, the agenda and the blocked-time list.
      await Promise.allSettled([client.invalidateQueries({ predicate: query => isBookingQuery(query.queryKey) })]);
      if (isCurrent()) { setOpen(false); onSaved?.(); }
    } catch (error) {
      if (!isCurrent()) return;
      const listed = blockConflicts(error);
      if (listed) setConflicts(listed); else setFailure(saveFailure(error));
    } finally { operation.current = false; if (scope.mounted.current) setBusy(false); }
  }
  return {
    t, locale, direction, timezone, today: timezone ? localDate(timezone) : '', open, form, errors, conflicts, failure, busy, ready: Boolean(timezone),
    openDialog, close, update, save: () => { void submit(); },
    when: (instant: string) => timezone ? `${appointmentDate(instant, timezone, locale)} · ${appointmentTime(instant, timezone, locale)}` : '',
  };
}
export type TimeBlockDialogState = ReturnType<typeof useTimeBlockDialog>;

/** Removal asks first, with Confirm and Cancel side by side, as service deletion does. */
export function useBlockRemoval(businessId: string, onRemoved?: () => void) {
  const client = useQueryClient(), scope = useCurrentScope(businessId), operation = useRef(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<MessageKey | ''>('');
  function askRemove(id: string | null) { if (!operation.current) { setRemoving(id); setFailure(''); } }
  async function confirmRemove(id: string) {
    if (operation.current) return;
    operation.current = true; setPending(id); setFailure('');
    const isCurrent = scope.capture();
    try {
      await removeTimeBlock(businessId, id);
      if (!isCurrent()) return;
      await Promise.allSettled([client.invalidateQueries({ predicate: query => isBookingQuery(query.queryKey) })]);
      if (isCurrent()) { setRemoving(null); onRemoved?.(); }
    } catch (error) {
      if (!isCurrent()) return;
      // Already gone: the refreshed list no longer shows it, which is what the owner wanted.
      if (error instanceof ApiError && error.status === 404) { setRemoving(null); await Promise.allSettled([client.invalidateQueries({ predicate: query => isBookingQuery(query.queryKey) })]); }
      else setFailure('blocks.removeFailed');
    } finally { operation.current = false; if (scope.mounted.current) setPending(null); }
  }
  return { removing, pending, removeFailure: failure, askRemove, confirmRemove: (id: string) => void confirmRemove(id) };
}
export type BlockRemovalState = ReturnType<typeof useBlockRemoval>;

type StaffRow = { id: string; displayName: string; active: boolean };
/** The hours screen's blocked-time section: upcoming blocks, the dialog and removal. */
export function useTimeBlocks(businessId: string) {
  const { t, locale, direction } = useAppLocale(), scope = useCurrentScope(businessId);
  const list = useQuery({ queryKey: ['provider', businessId, 'time-blocks', scope.identity, scope.version], queryFn: ({ signal }) => readTimeBlocks(businessId, signal), enabled: Boolean(scope.identity && scope.focused) });
  const staff = useQuery({ queryKey: ['provider', businessId, 'block-staff', scope.identity, scope.version], queryFn: ({ signal }) => apiRequest<{ staff: StaffRow[] }>(`/v1/provider/businesses/${encodeURIComponent(businessId)}/staff`, { signal }), enabled: Boolean(scope.identity && scope.focused) });
  const [message, setMessage] = useState<MessageKey | ''>('');
  const dialog = useTimeBlockDialog(businessId, list.data?.timezone, () => setMessage('blocks.saved'));
  const removal = useBlockRemoval(businessId, () => setMessage('blocks.removed'));
  return {
    t, locale, direction, dialog, ...removal,
    blocks: list.data?.blocks ?? [], loading: list.isLoading, failed: list.isError, ready: Boolean(list.data),
    // Only active staff can be blocked; an inactive one takes no bookings anyway.
    staff: (staff.data?.staff ?? []).filter(row => row.active),
    message, retry: () => { void list.refetch(); void staff.refetch(); },
    openDialog: () => { setMessage(''); dialog.openDialog(); },
  };
}
export type TimeBlocksState = ReturnType<typeof useTimeBlocks>;
