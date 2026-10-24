import { useAppLocale } from '@/src/i18n/LocaleContext';
import { useEffect, useRef, useState } from 'react';
import { ActionButton } from '../ActionButton';
import type { GoogleSigninButtonProps } from './GoogleSigninButton';

type GoogleSDK = { accounts: { id: { initialize: (options: { client_id: string; callback: (response: { credential: string }) => void }) => void; renderButton: (element: HTMLElement, options: { type: string; size: string; theme: string; width: number; locale: string }) => void } } };
export function GoogleSigninButton({ enabled, onCredential, onError }: GoogleSigninButtonProps) {
  const { t, locale } = useAppLocale();
  const host = useRef<HTMLDivElement>(null);
  const credential = useRef(onCredential);
  const error = useRef(onError);
  const loadFailureMessage = useRef(t('auth.googleLoadFailed'));
  const [failed, setFailed] = useState(false);
  const clientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  useEffect(() => { credential.current = onCredential; error.current = onError; }, [onCredential, onError]);
  useEffect(() => { loadFailureMessage.current = t('auth.googleLoadFailed'); });
  useEffect(() => {
    if (!enabled || !clientId) return;
    let active = true;
    const render = () => {
      const sdk = (window as unknown as { google?: GoogleSDK }).google;
      if (!active || !sdk || !host.current) return;
      sdk.accounts.id.initialize({ client_id: clientId, callback: ({ credential: idToken }) => credential.current(idToken) });
      sdk.accounts.id.renderButton(host.current, { type: 'standard', size: 'large', theme: 'outline', width: 300, locale });
    };
    let script = document.querySelector<HTMLScriptElement>('script[data-visit-google]');
    if (!script) { script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.dataset.visitGoogle = 'true'; document.head.appendChild(script); }
    const fail = () => { if (active) { setFailed(true); error.current(loadFailureMessage.current); } };
    script.addEventListener('load', render); script.addEventListener('error', fail); render();
    return () => { active = false; script?.removeEventListener('load', render); script?.removeEventListener('error', fail); };
  }, [enabled, clientId, locale]);
  if (!enabled || !clientId || failed) return <ActionButton secondary disabled label={t('auth.googleUnavailable')} />;
  return <div ref={host} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />;
}
