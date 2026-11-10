import { create } from 'zustand';
type PromptState = { pending: ((confirmed: boolean) => void) | null; ask: () => Promise<boolean>; answer: (confirmed: boolean) => void };
// One cancel question at a time: a new question answers a forgotten one "keep", so no caller waits forever.
export const useCancellationPrompt = create<PromptState>((set, get) => ({
  pending: null,
  ask: () => new Promise<boolean>(resolve => { get().pending?.(false); set({ pending: resolve }); }),
  answer: confirmed => { const pending = get().pending; set({ pending: null }); pending?.(confirmed); },
}));
