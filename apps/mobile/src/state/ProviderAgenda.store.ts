import { create } from 'zustand';
import type { AgendaDraft } from '../types/ProviderAgenda.types';
export const emptyAgendaDraft: Readonly<AgendaDraft> = { date: '', mode: 'day' };
type State = { scope: string; draft: AgendaDraft; update: (scope: string, patch: Partial<AgendaDraft>) => void; clear: () => void };
export const useAgendaDraft = create<State>(set => ({ scope: '', draft: { ...emptyAgendaDraft }, update: (scope, patch) => set(state => ({ scope, draft: { ...(state.scope === scope ? state.draft : emptyAgendaDraft), ...patch } })), clear: () => set({ scope: '', draft: { ...emptyAgendaDraft } }) }));
