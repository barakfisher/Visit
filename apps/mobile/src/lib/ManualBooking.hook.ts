import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { formatPrice } from '../i18n/messages';
import { useAppLocale } from '../i18n/LocaleContext';
import { useSessionStore } from '../state/session';
import { useManualDraft, emptyManualDraft } from '../state/ManualBooking.store';
import { agendaDraftScope, useAgendaDraft } from '../state/ProviderAgenda.store';
import { readManualOptions, submitManualBooking } from './ManualBooking.service';
import { manualDraftScope, manualInput } from './ManualBooking.utils';
import { canContinueAppointmentAction } from './AppointmentLifecycle.utils';
import { isBookingQuery } from './BookingQueries.utils';
import { useCompactBooking } from './CompactBooking.hook';
import { availableBookingSlots, bookingSlotId, validBookingDate } from './CompactBooking.utils';
import { apiRequest, ApiError } from './api';
import type { ProviderDetail, Slot } from '../types/flows';
import type { ManualBookingView, ManualDraft } from '../types/ManualBooking.types';

/**
 * The Add appointment sheet over the business home (decisions.md, 2026-11-11). The service, date and time are chosen the
 * way a customer chooses them, from the business's free slots; a slot brings its staff member and UTC offset.
 */
export function useManualBooking(business: { id: string; timezone: string }, date: string): ManualBookingView {
  const { t, locale } = useAppLocale(), client = useQueryClient(), identity = useSessionStore(state => state.identityId), version = useSessionStore(state => state.contextVersion);
  const scope = manualDraftScope(identity, version, business.id);
  const prepared = useManualDraft(state => state.scope === scope ? state.prepared : null);
  const stored = useManualDraft(state => state.scope === scope ? state.draft : emptyManualDraft), attempt = useManualDraft(state => state.scope === scope ? state.attempt : null), result = useManualDraft(state => state.scope === scope ? state.result : null);
  const [state, setState] = useState({ scope, busy: false, feedback: '' });
  const [staffFilter, setStaffFilter] = useState({ scope: '', staffId: '' });
  const mounted = useRef(true), operation = useRef(false), focused = useIsFocused(), focusRef = useRef(focused);
  useEffect(() => { focusRef.current = focused; }, [focused]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const open = stored.open && focused;
  const options = useQuery({ queryKey: ['provider', business.id, 'manual-options', identity, version], queryFn: ({ signal }) => readManualOptions(business.id, signal), enabled: open });
  const draft = { ...stored, localDate: stored.localDate || date };
  // The public business page carries the services the calendar reads; only services with assigned staff are offered.
  const details = useQuery({ queryKey: ['provider', identity, version, business.id, 'public'], queryFn: ({ signal }) => apiRequest<{ provider: ProviderDetail }>(`/api/providers/${encodeURIComponent(business.id)}`, { signal }), enabled: open && Boolean(options.data?.bookable) });
  const assigned = new Map(options.data?.services.filter(row => row.staff.length).map(row => [row.id, row]) ?? []);
  const provider = details.data ? { ...details.data.provider, services: details.data.provider.services.filter(row => assigned.has(row.id)) } : undefined;
  const slots = useQuery({ queryKey: ['availability', identity, version, business.id, 'public', draft.serviceId, draft.localDate], queryFn: ({ signal }) => apiRequest<{ slots: Slot[] }>(`/api/providers/${encodeURIComponent(business.id)}/availability?${new URLSearchParams({ serviceId: draft.serviceId, date: draft.localDate })}`, { signal }), enabled: open && Boolean(draft.serviceId) && validBookingDate(draft.localDate), staleTime: 0 });
  const staff = assigned.get(draft.serviceId)?.staff ?? [];
  const filter = staffFilter.scope === `${scope}:${draft.serviceId}` && staff.some(row => row.id === staffFilter.staffId) ? staffFilter.staffId : '';
  const offered = availableBookingSlots(slots.data?.slots ?? [], null).filter(slot => !filter || slot.staffId === filter);
  // A free card or an earlier choice names a time (and maybe a staff member); it is chosen while a matching slot is free.
  const chosen = draft.localTime ? offered.find(slot => slot.localTime === draft.localTime && (!draft.staffId || slot.staffId === draft.staffId)) : undefined;
  function update(patch: Partial<ManualDraft>) { if (!operation.current && !attempt) { setState({ scope, busy: false, feedback: '' }); useManualDraft.getState().update(scope, { ...patch, reviewed: false }); } }
  const disabled = state.scope === scope && state.busy || Boolean(attempt);
  const controls = useCompactBooking({ provider, providerId: business.id, serviceId: draft.serviceId, date: draft.localDate, fromBookingId: undefined, slots: offered, excluded: null, disabled,
    onDate: localDate => update({ localDate, localTime: '', staffId: '', utcOffset: '' }), onService: serviceId => update({ serviceId }) });
  function review() {
    if (operation.current || attempt) return;
    const picked: ManualDraft = { ...draft, staffId: chosen?.staffId ?? '', localTime: chosen?.localTime ?? '', utcOffset: chosen?.utcOffset ?? '' };
    const input = chosen ? manualInput(picked, options.data, Crypto.randomUUID()) : null;
    if (!input) { setState({ scope, busy: false, feedback: t('manual.invalid') }); return; }
    useManualDraft.getState().update(scope, picked);
    useManualDraft.getState().prepare(scope, input);
  }
  async function confirm() {
    if (operation.current || !identity || (!stored.reviewed && !attempt)) return;
    const input = attempt ?? prepared;
    if (!input) { setState({ scope, busy: false, feedback: t('manual.invalid') }); return; }
    const initial = { identityId: identity, contextVersion: version, activeBusinessId: business.id };
    const current = () => focusRef.current && canContinueAppointmentAction(initial, useSessionStore.getState(), mounted.current, business.id);
    if (!current()) return;
    operation.current = true; useManualDraft.getState().begin(scope, input); setState({ scope, busy: true, feedback: '' });
    try {
      const saved = await submitManualBooking(business.id, input, identity);
      if (!current()) return;
      useManualDraft.getState().finish(scope, saved);
      setState({ scope, busy: true, feedback: '' });
      await client.invalidateQueries({ predicate: query => isBookingQuery(query.queryKey) });
    } catch (error) {
      if (!current()) return;
      const definite = error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429;
      if (definite) useManualDraft.getState().unlock(scope);
      setState({ scope, busy: true, feedback: t(!definite ? 'manual.uncertain' : error instanceof ApiError && error.code === 'INVALID_LOCAL_TIME' ? 'manual.invalidTime' : 'manual.conflict') });
      if (definite) await Promise.allSettled([options.refetch(), slots.refetch()]);
    } finally { operation.current = false; if (mounted.current) setState(previous => ({ ...previous, busy: false })); }
  }
  const reviewed = (attempt ?? prepared)?.reviewedService;
  const serviceSummary = reviewed ? t('manual.summary', { name: reviewed.name, minutes: reviewed.durationMinutes, price: reviewed.priceMinor !== null && reviewed.currency ? formatPrice(locale, reviewed.priceMinor, reviewed.currency) : t('manual.priceUnknown') }) : '';
  const success = Boolean(result);
  function close() {
    if (operation.current || attempt) return;
    // After a save the home says which day it was saved for; it shows only today.
    const savedDay = success ? draft.localDate : '';
    setState({ scope, busy: false, feedback: '' }); useManualDraft.getState().clear();
    if (savedDay) useAgendaDraft.getState().update(agendaDraftScope(identity, version, business.id), { savedDate: savedDay });
  }
  const picking = options.data?.bookable ? {
    controls, disabled, date: draft.localDate, selectedId: chosen ? bookingSlotId(chosen) : null, slotLoading: slots.isLoading || details.isLoading, slotError: slots.isError || details.isError,
    onRetrySlots: () => { void details.refetch(); void slots.refetch(); },
    onSelectSlot: (id: string) => { const slot = offered.find(row => bookingSlotId(row) === id); if (slot) update({ staffId: slot.staffId, localTime: slot.localTime, utcOffset: slot.utcOffset }); },
    staff, staffFilter: filter, onStaffFilter: (staffId: string) => setStaffFilter({ scope: `${scope}:${draft.serviceId}`, staffId }),
    slotLabel: chosen ? `${chosen.localTime}${staff.length > 1 ? ` · ${chosen.staffName}` : ''}` : '',
  } : null;
  return { serviceSummary, t, draft, options: options.data, loading: options.isLoading, loadError: options.isError, busy: state.scope === scope && state.busy, locked: Boolean(attempt), feedback: result ? t(result.status === 'CONFIRMED' ? 'manual.saved' : 'manual.changed') : state.scope === scope ? state.feedback : '', success, picking, update, retry: () => { void options.refetch(); }, review, confirm: () => void confirm(), close };
}
