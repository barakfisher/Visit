import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { clearInitialURL, useLinkingURL } from 'expo-linking';
import { invitationToken } from './invitationToken';
export function useInvitation() {
  const incoming = useLinkingURL();
  const [token, setToken] = useState('');
  useEffect(() => {
    if (!incoming) return;
    const value = invitationToken(incoming);
    router.setParams({ '#': '', invite: undefined }); clearInitialURL();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (value) setToken(value);
  }, [incoming]);
  return { token, clear: () => setToken('') };
}
