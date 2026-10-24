import type { AuthProfile } from '../types/flows';
import { create } from 'zustand';
import { queryClient } from '../lib/queryClient';

type SessionState = {
  contextVersion: number;
  token: string | null;
  profile: AuthProfile | null;
  setAuth: (token: string | null, profile: AuthProfile) => void;
  identityId: string | null;
  activeBusinessId: string | null;
  setIdentity: (identityId: string | null) => void;
  selectBusiness: (businessId: string | null) => void;
  clear: () => void;
};

export const useSessionStore = create<SessionState>((set, get) => ({
  contextVersion: 0,
  token: null,
  profile: null,
  setAuth: (token, profile) => {
    const changedIdentity = profile.id !== get().identityId;
    const removedBusiness = Boolean(get().activeBusinessId && !profile.businesses.some((business) => business.id === get().activeBusinessId));
    if (changedIdentity || removedBusiness) queryClient.clear();
    set({ token, profile, identityId: profile.id, ...(changedIdentity || removedBusiness ? { activeBusinessId: null, contextVersion: get().contextVersion + 1 } : {}) });
  },
  identityId: null,
  activeBusinessId: null,
  setIdentity: (identityId) => {
    if (identityId !== get().identityId) queryClient.clear();
    set({ identityId, ...(identityId !== get().identityId ? { activeBusinessId: null, profile: null, token: null, contextVersion: get().contextVersion + 1 } : {}) });
  },
  selectBusiness: (businessId) => {
    const previousId = get().activeBusinessId;
    if (previousId === businessId) return;
    if (businessId && !get().profile?.businesses.some((business) => business.id === businessId)) throw new Error('Choose a business from your account.');
    // clear cancels active queries, removes every private prefix and resets mutations.
    queryClient.clear();
    set({ activeBusinessId: businessId, contextVersion: get().contextVersion + 1 });
  },
  clear: () => {
    queryClient.clear();
    set({ identityId: null, activeBusinessId: null, token: null, profile: null, contextVersion: get().contextVersion + 1 });
  },
}));
