import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useIsFocused } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { formatPrice } from '../i18n/messages';
import { useAppLocale } from '../i18n/LocaleContext';
import { useSessionStore } from '../state/session';
import { useManualDraft, emptyManualDraft } from '../state/ManualBooking.store';
import { agendaDraftScope, useAgendaDraft } from '../state/ProviderAgenda.store';
import { useProviderWorkspace } from '../../components/ProviderAccess';
import { readManualOptions, submitManualBooking } from './ManualBooking.service';
import { openManualBooking } from './ManualBookingEntry';
import { todayInTimezone } from './calendar';
import { manualDraftScope, manualInput } from './ManualBooking.utils';
import { canContinueAppointmentAction } from './AppointmentLifecycle.utils';
import { isBookingQuery } from './BookingQueries.utils';
import { ApiError } from './api';
import type { ManualBookingView, ManualDraft } from '../types/ManualBooking.types';
export function useManualBooking(business: { id: string; timezone: string }, date: string): ManualBookingView {
  const { t, locale } = useAppLocale(), client = useQueryClient(), identity = useSessionStore(state => state.identityId), version = useSessionStore(state => state.contextVersion);
  const scope = manualDraftScope(identity, version, business.id);
  const prepared = useManualDraft(state => state.scope === scope ? state.prepared : null);
  const stored = useManualDraft(state => state.scope === scope ? state.draft : emptyManualDraft), attempt = useManualDraft(state => state.scope === scope ? state.attempt : null), result = useManualDraft(state => state.scope === scope ? state.result : null);
  const [state, setState] = useState({ scope, busy: false, feedback: '' });
  const mounted = useRef(true), operation = useRef(false), focused = useIsFocused(), focusRef = useRef(focused);
  useEffect(() => { focusRef.current = focused; }, [focused]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const options = useQuery({ queryKey: ['provider', business.id, 'manual-options', identity, version], queryFn: ({ signal }) => readManualOptions(business.id, signal), enabled: stored.open && focused });
  const draft = { ...stored, localDate: stored.localDate || date };
  function update(patch: Partial<ManualDraft>) { if (!operation.current && !attempt) { setState({ scope, busy: false, feedback: '' }); useManualDraft.getState().update(scope, { ...patch, reviewed: false }); } }
  function review() {
    if (operation.current || attempt) return;
    const input = manualInput(draft, options.data, Crypto.randomUUID());
    if (!input) { setState({ scope, busy: false, feedback: t('manual.invalid') }); return; }
    useManualDraft.getState().update(scope, draft);
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
      setState({ scope, busy: true, feedback: t(!definite ? 'manual.uncertain' : error instanceof ApiError && error.code === 'INVALID_LOCAL_TIME' ? 'manual.invalidTime' : error instanceof ApiError && error.code === 'MANUAL_EXCEPTION_REQUIRED' ? 'manual.exceptionRequired' : 'manual.conflict') });
      if (definite) await options.refetch();
    } finally { operation.current = false; if (mounted.current) setState(previous => ({ ...previous, busy: false })); }
  }
  const reviewed = (attempt ?? prepared)?.reviewedService;
  const serviceSummary = reviewed ? t('manual.summary', { name: reviewed.name, minutes: reviewed.durationMinutes, price: reviewed.priceMinor !== null && reviewed.currency ? formatPrice(locale, reviewed.priceMinor, reviewed.currency) : t('manual.priceUnknown') }) : '';
  return { serviceSummary, t, draft, options: options.data, loading: options.isLoading, loadError: options.isError, busy: state.scope === scope && state.busy, locked: Boolean(attempt), feedback: result ? t(result.status === 'CONFIRMED' ? 'manual.saved' : 'manual.changed') : state.scope === scope ? state.feedback : '', success: Boolean(result), update, retry: () => { void options.refetch(); }, review, confirm: () => void confirm(), close: () => { if (!operation.current && !attempt) { setState({ scope, busy: false, feedback: '' }); useManualDraft.getState().clear(); } } };
}
/** The Add appointment screen (decisions.md, 2026-11-10). Reached directly, as after a reload, it starts a form; Close returns to the business home, which shows today and, after a save, confirms the saved appointment's day. */
export function useManualBookingScreen(): ManualBookingView {
  const business = useProviderWorkspace(), identity = useSessionStore(state => state.identityId), version = useSessionStore(state => state.contextVersion);
  const view = useManualBooking(business, todayInTimezone(business.timezone));
  // Only on arrival: after Close the form is cleared while the screen is still leaving, and must stay cleared.
  useEffect(() => { const manual = useManualDraft.getState(); if (manual.scope !== manualDraftScope(identity, version, business.id) || !manual.draft.open) openManualBooking(business.id); }, [identity, version, business.id]);
  function close() {
    if (view.busy || view.locked) return;
    const savedDay = view.success ? view.draft.localDate : '';
    view.close();
    if (savedDay) useAgendaDraft.getState().update(agendaDraftScope(identity, version, business.id), { savedDate: savedDay });
    router.dismissTo({ pathname: '/provider/dashboard', params: { businessId: business.id } });
  }
  return { ...view, close };
}
