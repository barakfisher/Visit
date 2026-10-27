import type { Locale, MessageKey } from '../i18n/messages';
export type ScheduleInterval = { startLocal: string; endLocal: string };
export type ScheduleException = { date: string; isOpen: boolean; startLocal: string | null; endLocal: string | null };
export type ScheduleRules = { weekly: (ScheduleInterval & { weekday: number })[]; overrides: ScheduleException[] };
export type ScheduleDraft = { weekly: ScheduleInterval[][]; overrides: ScheduleException[] };
export type ScheduleProposal = { weekly: { weekday: number; intervals: ScheduleInterval[] }[]; overrides: { date: string; isOpen: boolean; startLocal?: string | null; endLocal?: string | null }[] };
export type SchedulePreview = { token: string; timezone: string; canSave: boolean; affected: { id: string; revision: number; status: string; startsAt: string; endsAt: string; serviceName: string; staffName: string }[] };

export type ScheduleEditorState = { scope: string; draft: ScheduleDraft | null; preview: SchedulePreview | null; feedback: 'saved' | 'error' | '' };
export type ScheduleEditorView = {
  t: (key: MessageKey, values?: Record<string, string | number>) => string; locale: Locale;
  staff: boolean; ready: boolean; loading: boolean; failed: boolean; busy: boolean; feedback: 'saved' | 'error' | '';
  weekly: ScheduleInterval[][]; overrides: ScheduleException[]; preview: SchedulePreview | null;
  interval: (day: number, index: number, patch?: Partial<ScheduleInterval>) => void; exception: (index: number, patch: Partial<ScheduleException>) => void;
  inherit: () => void; addHours: (day: number) => void; removeException: (index: number) => void; addException: () => void; save: () => void; confirm: () => void; reload: () => void; when: (instant: string) => string;
};
