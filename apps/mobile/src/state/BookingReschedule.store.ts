import { create } from 'zustand';
import type { RescheduleAttempt } from '../types/BookingReschedule.types';
type State = { attempt: RescheduleAttempt | null; set: (attempt: RescheduleAttempt | null) => void };
export const useRescheduleAttempt = create<State>(set => ({ attempt: null, set: attempt => set({ attempt }) }));
