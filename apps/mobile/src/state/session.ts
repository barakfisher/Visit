import type { AuthProfile } from '../types/flows';
import { create } from 'zustand';
import { queryClient } from '../lib/queryClient';

type SessionState = {
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
  token: null,
  profile: null,
  setAuth: (token, profile) => {
    if (profile.id !== get().identityId) queryClient.clear();
    set({ token, profile, identityId: profile.id, ...(profile.id !== get().identityId ? { activeBusinessId: null } : {}) });
  },
  identityId: null,
  activeBusinessId: null,
  setIdentity: (identityId) => {
    if (identityId !== get().identityId) queryClient.clear();
    set({ identityId, ...(identityId !== get().identityId ? { activeBusinessId: null, profile: null, token: null } : {}) });
  },
  selectBusiness: (businessId) => {
    const previousId = get().activeBusinessId;
    if (previousId && previousId !== businessId) queryClient.removeQueries({ queryKey: ['business', previousId] });
    set({ activeBusinessId: businessId });
  },
  clear: () => {
    queryClient.clear();
    set({ identityId: null, activeBusinessId: null, token: null, profile: null });
  },
}));
