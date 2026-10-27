import { create } from 'zustand';
import type { ManualDraft, ManualInput, ManualResult } from '../types/ManualBooking.types';
export const emptyManualDraft: Readonly<ManualDraft> = { open: false, serviceId: '', staffId: '', localDate: '', localTime: '', utcOffset: '', customerName: '', customerPhone: '', customerEmail: '', exceptionReason: '', reviewed: false };
type State = { scope: string; draft: ManualDraft; prepared: ManualInput | null; prepare: (scope: string, input: ManualInput) => void; attempt: ManualInput | null; result: ManualResult | null; update: (scope: string, patch: Partial<ManualDraft>) => void; begin: (scope: string, input: ManualInput) => void; finish: (scope: string, result: ManualResult) => void; unlock: (scope: string) => void; clear: () => void };
export const useManualDraft = create<State>(set => ({ scope: '', draft: { ...emptyManualDraft }, prepared: null, attempt: null, result: null,
  update: (scope, patch) => set(state => state.scope === scope && state.attempt ? state : ({ scope, draft: { ...(state.scope === scope ? state.draft : emptyManualDraft), ...patch }, prepared: null, attempt: null, result: null })),
  prepare: (scope, prepared) => set(state => state.scope === scope ? { prepared, draft: { ...state.draft, reviewed: true } } : state),
  begin: (scope, attempt) => set(state => state.scope === scope ? { attempt } : state),
  finish: (scope, result) => set(state => state.scope === scope ? { result, prepared: null, attempt: null } : state),
  unlock: scope => set(state => state.scope === scope ? { prepared: null, attempt: null, draft: { ...state.draft, reviewed: false } } : state),
  clear: () => set({ scope: '', draft: { ...emptyManualDraft }, prepared: null, attempt: null, result: null }),
}));
