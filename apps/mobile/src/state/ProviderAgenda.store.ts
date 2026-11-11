import { create } from 'zustand';
import type { AgendaDraft } from '../types/ProviderAgenda.types';
/** What the home says on arrival belongs to one person, one session context and one business. */
export const agendaDraftScope = (identity: string | null, version: number, businessId: string) => JSON.stringify([identity, version, businessId]);
export const emptyAgendaDraft: Readonly<AgendaDraft> = { savedDate: '' };
type State = { scope: string; draft: AgendaDraft; update: (scope: string, patch: Partial<AgendaDraft>) => void; clear: () => void };
export const useAgendaDraft = create<State>(set => ({ scope: '', draft: { ...emptyAgendaDraft }, update: (scope, patch) => set(state => ({ scope, draft: { ...(state.scope === scope ? state.draft : emptyAgendaDraft), ...patch } })), clear: () => set({ scope: '', draft: { ...emptyAgendaDraft } }) }));
