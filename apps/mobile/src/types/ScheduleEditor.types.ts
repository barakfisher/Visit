export type ScheduleInterval = { startLocal: string; endLocal: string };
export type ScheduleRules = { weekly: (ScheduleInterval & { weekday: number })[] };
export type ScheduleDraft = { weekly: ScheduleInterval[][] };
export type ScheduleProposal = { weekly: { weekday: number; intervals: ScheduleInterval[] }[] };
export type SchedulePreview = { token: string; timezone: string; canSave: boolean; affected: { id: string; revision: number; status: string; startsAt: string; endsAt: string; serviceName: string; staffName: string }[] };

