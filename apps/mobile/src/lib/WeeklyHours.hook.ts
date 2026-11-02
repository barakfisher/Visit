import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useAppLocale } from '../i18n/LocaleContext';
import type { MessageKey } from '../i18n/messages';
import { useSessionStore } from '../state/session';
import { canContinueAppointmentAction } from './AppointmentLifecycle.utils';
import { isBookingQuery } from './BookingQueries.utils';
import { readSchedule, previewSchedule, saveSchedule } from './ScheduleEditor.service';
import { appointmentDate, appointmentTime } from './appointmentTime';
import { MAX_DAY_INTERVALS, WEEKDAYS, applyHoursForm, effectiveWeek, emptyHoursForm, scheduleDraft, scheduleProposal, toggleFormDay, validateHoursForm, type HoursForm, type HoursFormErrors } from './WeeklyHours';
import type { ScheduleInterval, SchedulePreview, ScheduleProposal } from '../types/ScheduleEditor.types';

/**
 * Business or staff weekly hours: a grouped summary, and an edit dialog that saves on its own.
 * Saving previews the change against existing appointments and commits only when nothing is affected.
 * Date overrides are not edited here; whatever the server holds is sent back unchanged.
 */
export function useWeeklyHours(businessId: string, staffId?: string) {
  const { t, locale, direction } = useAppLocale(), client = useQueryClient();
  const identity = useSessionStore(state => state.identityId), version = useSessionStore(state => state.contextVersion);
  const focused = useIsFocused(), focusRef = useRef(focused), mounted = useRef(true), operation = useRef(false);
  useEffect(() => { focusRef.current = focused; }, [focused]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const own = useQuery({ queryKey: ['provider', businessId, staffId ?? 'business', 'setup-hours', identity, version], queryFn: ({ signal }) => readSchedule(businessId, staffId, signal), enabled: Boolean(identity && focused) });
  // Staff hours start from the business hours, so the staff editor reads both.
  const business = useQuery({ queryKey: ['provider', businessId, 'business', 'setup-hours', identity, version], queryFn: ({ signal }) => readSchedule(businessId, undefined, signal), enabled: Boolean(staffId && identity && focused) });
  const draft = scheduleDraft(own.data);
  const { week, inherited } = effectiveWeek(draft.weekly, staffId ? scheduleDraft(business.data).weekly : undefined);
  const ready = Boolean(own.data && (!staffId || business.data)), failed = own.isError || Boolean(staffId) && business.isError;

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<HoursForm>(emptyHoursForm);
  const [errors, setErrors] = useState<HoursFormErrors>({});
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [failure, setFailure] = useState<MessageKey | ''>('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function edit(next: HoursForm) { if (!operation.current) { setForm(next); setErrors({}); setPreview(null); setFailure(''); } }
  function openEdit() { if (operation.current || !ready) return; setForm(emptyHoursForm()); setErrors({}); setPreview(null); setFailure(''); setSaved(false); setFormOpen(true); }
  /** A pending save keeps the dialog open, so its result lands where the owner is looking. */
  function cancelForm() { if (!operation.current) { setFormOpen(false); setPreview(null); setFailure(''); } }
  function capture() {
    const initial = { identityId: identity, contextVersion: version, activeBusinessId: businessId };
    return () => focusRef.current && canContinueAppointmentAction(initial, useSessionStore.getState(), mounted.current, businessId);
  }
  async function commit(proposal: ScheduleProposal) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setPreview(null); setFailure(''); setSaved(false);
    const isCurrent = capture();
    try {
      const impact = await previewSchedule(businessId, staffId, proposal);
      if (!isCurrent()) return;
      if (!impact.canSave || impact.affected.length) { setPreview(impact); return; }
      await saveSchedule(businessId, staffId, proposal, impact.token);
      if (!isCurrent()) return;
      // Hours change slots, the agenda and the settings hub's completion.
      await Promise.allSettled([client.invalidateQueries({ predicate: query => isBookingQuery(query.queryKey) })]);
      if (isCurrent()) { setFormOpen(false); setSaved(true); }
    } catch { if (isCurrent()) setFailure('hours.saveFailed'); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  function save() {
    if (operation.current || !ready) return;
    const found = validateHoursForm(form, week, Boolean(staffId));
    setErrors(found);
    if (!Object.keys(found).length) void commit(scheduleProposal({ weekly: applyHoursForm(week, form), overrides: draft.overrides }));
  }
  /** Staff only: drop the staff member's own week so they follow the business hours again. */
  function followBusiness() { if (staffId && ready && !inherited) void commit(scheduleProposal({ weekly: WEEKDAYS.map(() => []), overrides: draft.overrides })); }
  function retry() { void own.refetch(); if (staffId) void business.refetch(); }

  return {
    t, locale, direction, staff: Boolean(staffId), loading: !ready && !failed, failed, ready, week, inherited,
    formOpen, form, errors, preview, failure, saved, busy, canAddInterval: form.intervals.length < MAX_DAY_INTERVALS,
    openEdit, cancelForm, save, followBusiness, retry,
    toggleDay: (day: number) => edit(toggleFormDay(form, day, week)),
    setClosed: (closed: boolean) => edit({ ...form, closed }),
    setInterval: (index: number, patch: Partial<ScheduleInterval>) => edit({ ...form, intervals: form.intervals.map((row, i) => i === index ? { ...row, ...patch } : row) }),
    addInterval: () => { if (form.intervals.length < MAX_DAY_INTERVALS) edit({ ...form, intervals: [...form.intervals, { startLocal: '', endLocal: '' }] }); },
    removeInterval: (index: number) => edit({ ...form, intervals: form.intervals.filter((_, i) => i !== index) }),
    when: (instant: string) => preview ? `${appointmentDate(instant, preview.timezone, locale)} · ${appointmentTime(instant, preview.timezone, locale)}` : '',
  };
}
export type WeeklyHoursState = ReturnType<typeof useWeeklyHours>;
