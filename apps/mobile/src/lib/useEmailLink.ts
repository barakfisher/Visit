import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { clearInitialURL, useLinkingURL } from 'expo-linking';
import { emailTokenFromUrl } from './emailLinkToken';

export function useEmailLink() {
  const incoming = useLinkingURL();
  const [token, setToken] = useState('');
  useEffect(() => {
    if (!incoming) return;
    const value = emailTokenFromUrl(incoming);
    if (!value) return;
    // Receive an external navigation event without consuming its credential.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToken(value);
    router.setParams({ token: undefined, '#': undefined });
    clearInitialURL();
  }, [incoming]);
  return { token, clear: () => setToken('') };
}
