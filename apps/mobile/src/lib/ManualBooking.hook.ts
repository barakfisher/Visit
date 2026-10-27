import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import * as Crypto from 'expo-crypto';
import { formatPrice } from '../i18n/messages';
import { useAppLocale } from '../i18n/LocaleContext';
import { useSessionStore } from '../state/session';
import { useManualDraft, emptyManualDraft } from '../state/ManualBooking.store';
import { readManualOptions, submitManualBooking } from './ManualBooking.service';
import { manualInput } from './ManualBooking.utils';
import { canContinueAppointmentAction } from './AppointmentLifecycle.utils';
import { isBookingQuery } from './BookingQueries.utils';
import { timePolicyNote } from './appointmentTime';
import { ApiError } from './api';
import type { ManualBookingView, ManualDraft } from '../types/ManualBooking.types';
export function useManualBooking(business: { id: string; timezone: string }, date: string): ManualBookingView {
  const { t, locale } = useAppLocale(), client = useQueryClient(), identity = useSessionStore(state => state.identityId), version = useSessionStore(state => state.contextVersion);
  const scope = JSON.stringify([identity, version, business.id]);
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
      setState({ scope, busy: true, feedback: t(saved.status === 'CONFIRMED' ? 'manual.saved' : 'manual.changed') });
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
  return { serviceSummary, t, draft, options: options.data, loading: options.isLoading, loadError: options.isError, busy: state.scope === scope && state.busy, locked: Boolean(attempt), feedback: state.scope === scope ? state.feedback : '', success: Boolean(result), timeNote: timePolicyNote(business.timezone, locale), update, retry: () => { void options.refetch(); }, review, confirm: () => void confirm(), close: () => { if (!operation.current && !attempt) useManualDraft.getState().clear(); } };
}
