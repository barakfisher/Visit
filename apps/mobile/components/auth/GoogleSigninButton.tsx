import { useRef, useState } from 'react';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { beginGoogleSignIn, googleNativeAvailable } from '@/src/lib/googleFlow';
import type { GoogleStart } from '@/src/lib/googleCallback';
import { ActionButton } from '../ActionButton';
// Shown only where the server offers Google (`offersGoogle`), so it has no "not configured" state of its own.
export type GoogleSigninButtonProps = GoogleStart & { disabled?: boolean; onError: (message: string) => void; onBusyChange?: (busy: boolean) => void };
export function GoogleSigninButton({ disabled, intent, returnTo, onError, onBusyChange }: GoogleSigninButtonProps) {
  const { t } = useAppLocale();
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const supported = googleNativeAvailable();
  async function signIn() {
    if (running.current) return;
    running.current = true; onBusyChange?.(true); setBusy(true);
    try { await beginGoogleSignIn({ intent, returnTo }); }
    catch { onError(t('auth.failure')); }
    finally { running.current = false; onBusyChange?.(false); setBusy(false); }
  }
  return <ActionButton secondary disabled={disabled || !supported} busy={busy} label={!supported ? t('auth.googleBuild') : t(intent === 'link' ? 'auth.googleLink' : 'auth.google')} onPress={() => void signIn()} />;
}
