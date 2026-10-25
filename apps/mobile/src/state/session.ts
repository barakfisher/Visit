import type { AuthProfile } from '../types/flows';
import { create } from 'zustand';
import { queryClient } from '../lib/queryClient';

type SessionState = {
  bootstrapStatus: 'loading' | 'ready' | 'error';
  bootstrapAttempt: number;
  setBootstrapStatus: (status: 'loading' | 'ready' | 'error') => void;
  retryBootstrap: () => void;
  contextVersion: number;
  token: string | null;
  profile: AuthProfile | null;
  resetAuthContext: (token: string | null, profile: AuthProfile) => void;
  setAuth: (token: string | null, profile: AuthProfile) => void;
  identityId: string | null;
  activeBusinessId: string | null;
  setIdentity: (identityId: string | null) => void;
  selectBusiness: (businessId: string | null) => void;
  clear: () => void;
};

export const useSessionStore = create<SessionState>((set, get) => ({
  bootstrapStatus: 'loading', bootstrapAttempt: 0,
  setBootstrapStatus: bootstrapStatus => set({ bootstrapStatus }),
  retryBootstrap: () => set({ bootstrapStatus: 'loading', bootstrapAttempt: get().bootstrapAttempt + 1 }),
  contextVersion: 0,
  token: null,
  profile: null,
  setAuth: (token, profile) => {
    const changedIdentity = profile.id !== get().identityId;
    const removedBusiness = Boolean(get().activeBusinessId && !profile.businesses.some((business) => business.id === get().activeBusinessId));
    if (changedIdentity || removedBusiness) queryClient.clear();
    set({ token, profile, identityId: profile.id, bootstrapStatus: 'ready', ...(changedIdentity || removedBusiness ? { activeBusinessId: null, contextVersion: get().contextVersion + 1 } : {}) });
  },
  resetAuthContext: (token, profile) => {
    const previous = get();
    if (previous.identityId && previous.identityId !== profile.id) throw new Error('The signed-in account changed.');
    queryClient.clear();
    set({ token, profile, identityId: profile.id, bootstrapStatus: 'ready', contextVersion: previous.contextVersion + 1, activeBusinessId: profile.businesses.some(business => business.id === previous.activeBusinessId) ? previous.activeBusinessId : null });
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
    set({ identityId: null, activeBusinessId: null, token: null, profile: null, bootstrapStatus: 'ready', contextVersion: get().contextVersion + 1 });
  },
}));
