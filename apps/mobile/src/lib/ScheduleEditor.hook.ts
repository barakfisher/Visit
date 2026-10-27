import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIsFocused } from 'expo-router';
import { useAppLocale } from '../i18n/LocaleContext';
import { useSessionStore } from '../state/session';
import { canContinueAppointmentAction } from './AppointmentLifecycle.utils';
import { isBookingQuery } from './BookingQueries.utils';
import { readSchedule, previewSchedule, saveSchedule } from './ScheduleEditor.service';
import { scheduleDraft, scheduleProposal } from './ScheduleEditor.utils';
import { appointmentDate, appointmentTime } from './appointmentTime';
import type { ScheduleDraft, ScheduleException, ScheduleInterval, SchedulePreview, ScheduleEditorState, ScheduleEditorView } from '../types/ScheduleEditor.types';
export function useScheduleEditor(businessId: string, staffId?: string): ScheduleEditorView {
  const { t, locale } = useAppLocale(), client = useQueryClient();
  const identity = useSessionStore(state => state.identityId), version = useSessionStore(state => state.contextVersion);
  const scope = JSON.stringify([identity, version, businessId, staffId]), scopeRef = useRef(scope);
  const initial: ScheduleEditorState = { scope, draft: null, preview: null, feedback: '' };
  const [editor, setEditor] = useState<ScheduleEditorState>(initial);
  const { draft, preview, feedback } = editor.scope === scope ? editor : initial;
  function updateEditor(patch: Partial<ScheduleEditorState>) { setEditor(previous => ({ ...(previous.scope === scope ? previous : initial), ...patch, scope })); }
  function setDraft(value: ScheduleDraft | null) { updateEditor({ draft: value }); }
  function setPreview(value: SchedulePreview | null) { updateEditor({ preview: value }); }
  function setFeedback(value: ScheduleEditorState['feedback']) { updateEditor({ feedback: value }); }
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true), operation = useRef(false), focused = useIsFocused(), focusRef = useRef(focused);
  useEffect(() => { scopeRef.current = scope; }, [scope]);
  useEffect(() => { focusRef.current = focused; }, [focused]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const query = useQuery({ queryKey: ['provider', businessId, staffId ?? 'business', 'setup-hours', identity, version], queryFn: ({ signal }) => readSchedule(businessId, staffId, signal), enabled: Boolean(identity && focused) });
  const current = draft ?? scheduleDraft(query.data);
  function edit(next: ScheduleDraft) { if (!operation.current) { setDraft(next); setPreview(null); setFeedback(''); } }
  function interval(day: number, index: number, patch?: Partial<ScheduleInterval>) { edit({ ...current, weekly: current.weekly.map((hours, d) => d !== day ? hours : patch ? hours.map((row, i) => i === index ? { ...row, ...patch } : row) : hours.filter((_, i) => i !== index)) }); }
  function exception(index: number, patch: Partial<ScheduleException>) { edit({ ...current, overrides: current.overrides.map((row, i) => i === index ? { ...row, ...patch } : row) }); }
  function capture() {
    const initial = { identityId: identity, contextVersion: version, activeBusinessId: businessId };
    return () => scopeRef.current === scope && focusRef.current && canContinueAppointmentAction(initial, useSessionStore.getState(), mounted.current, businessId);
  }
  async function save(confirm = false) {
    if (operation.current || !query.data || confirm && (!preview?.canSave || preview.affected.length)) return;
    operation.current = true; setBusy(true); setFeedback(''); const isCurrent = capture(), proposal = scheduleProposal(current);
    try {
      if (!isCurrent()) return;
      if (confirm && preview) {
        await saveSchedule(businessId, staffId, proposal, preview.token);
        if (!isCurrent()) return;
        await Promise.allSettled([client.invalidateQueries({ predicate: query => isBookingQuery(query.queryKey) })]);
        if (isCurrent()) { setPreview(null); setDraft(null); setFeedback('saved'); }
      } else { const result = await previewSchedule(businessId, staffId, proposal); if (isCurrent()) setPreview(result); }
    } catch { if (isCurrent()) { setPreview(null); setFeedback('error'); } }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  async function reload() {
    if (operation.current) return;
    const isCurrent = capture(), result = await query.refetch();
    if (isCurrent() && result.isSuccess) { setDraft(null); setPreview(null); setFeedback(''); }
  }
  return { t, locale, staff: Boolean(staffId), ready: Boolean(query.data), loading: query.isPending, failed: query.isError, busy, feedback, weekly: current.weekly, overrides: current.overrides, preview,
    interval, exception, inherit: () => edit({ ...current, weekly: Array.from({ length: 7 }, () => []) }), addHours: (day: number) => edit({ ...current, weekly: current.weekly.map((hours, d) => d === day ? [...hours, { startLocal: '09:00', endLocal: '17:00' }] : hours) }),
    removeException: (index: number) => edit({ ...current, overrides: current.overrides.filter((_, i) => i !== index) }), addException: () => edit({ ...current, overrides: [...current.overrides, { date: '', isOpen: false, startLocal: '09:00', endLocal: '17:00' }] }),
    save: () => void save(), confirm: () => void save(true), reload: () => void reload(), when: (instant: string) => preview ? `${appointmentDate(instant, preview.timezone, locale)} · ${appointmentTime(instant, preview.timezone, locale)}` : '',
  };
}
