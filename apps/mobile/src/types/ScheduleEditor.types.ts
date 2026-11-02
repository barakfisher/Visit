export type ScheduleInterval = { startLocal: string; endLocal: string };
export type ScheduleException = { date: string; isOpen: boolean; startLocal: string | null; endLocal: string | null };
export type ScheduleRules = { weekly: (ScheduleInterval & { weekday: number })[]; overrides: ScheduleException[] };
export type ScheduleDraft = { weekly: ScheduleInterval[][]; overrides: ScheduleException[] };
export type ScheduleProposal = { weekly: { weekday: number; intervals: ScheduleInterval[] }[]; overrides: { date: string; isOpen: boolean; startLocal?: string | null; endLocal?: string | null }[] };
export type SchedulePreview = { token: string; timezone: string; canSave: boolean; affected: { id: string; revision: number; status: string; startsAt: string; endsAt: string; serviceName: string; staffName: string }[] };

