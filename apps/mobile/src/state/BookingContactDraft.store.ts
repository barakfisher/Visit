import { create } from 'zustand';
import type { BookingContactDraft } from '../types/BookingContact.types';
type DraftState = { draft: BookingContactDraft | null; save: (draft: BookingContactDraft) => void; clear: () => void };
// Advisory choices only; never persist credentials, contact proofs or reservations.
export const useBookingContactDraft = create<DraftState>(set => ({ draft: null, save: draft => set({ draft }), clear: () => set({ draft: null }) }));
