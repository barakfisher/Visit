import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { emailTokenFromUrl, withoutEmailToken } from './emailLinkToken';

export function useEmailLink() {
  const [token, setToken] = useState('');
  useEffect(() => {
    const receive = () => {
      const value = emailTokenFromUrl(window.location.href, window.location.origin);
      // Remove even malformed credentials before users follow any other links.
      const current = new URL(window.location.href);
      if (current.searchParams.has('token') || new URLSearchParams(current.hash.slice(1)).has('token')) router.setParams({ token: undefined, '#': undefined });
      window.history.replaceState(window.history.state, '', withoutEmailToken(current.href));
      if (value) setToken(value);
    };
    receive(); window.addEventListener('hashchange', receive);
    return () => window.removeEventListener('hashchange', receive);
  }, []);
  return { token, clear: () => setToken('') };
}
