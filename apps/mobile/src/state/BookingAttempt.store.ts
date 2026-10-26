import { create } from 'zustand';
import type { BookingAttempt } from '../types/BookingAttempt.types';
type State = { attempt: BookingAttempt | null; set: (attempt: BookingAttempt | null) => void };
// Retain one uncertain logical attempt across navigation; credentials never enter this store.
export const useBookingAttempt = create<State>(set => ({ attempt: null, set: attempt => set({ attempt }) }));
