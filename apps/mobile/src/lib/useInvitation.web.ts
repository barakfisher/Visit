import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { invitationToken } from './invitationToken';
export function useInvitation() {
  const [token, setToken] = useState('');
  useEffect(() => {
    const receive = () => {
      const value = invitationToken(window.location.href, window.location.origin);
      // Scrub malformed secrets too; never place the credential in a return URL or cache key.
      router.setParams({ '#': '', invite: undefined });
      window.history.replaceState(window.history.state, '', '/invite');
      // Router's initial hydration can commit the original address after this effect.
      // Finish scrubbing after its navigation update, without persisting the secret.
      queueMicrotask(() => { if (window.location.pathname === '/invite') window.history.replaceState(window.history.state, '', '/invite'); });
      if (value) setToken(value);
    };
    receive(); window.addEventListener('hashchange', receive);
    return () => window.removeEventListener('hashchange', receive);
  }, []);
  useEffect(() => {
    if (window.location.pathname === '/invite' && window.location.hash) window.history.replaceState(window.history.state, '', '/invite');
  });
  return { token, clear: () => setToken('') };
}
