import { useRef, useState } from 'react';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { beginGoogleSignIn, googleNativeAvailable } from '@/src/lib/googleFlow';
import type { GoogleStart } from '@/src/lib/googleCallback';
import { ActionButton } from '../ActionButton';
export type GoogleSigninButtonProps = GoogleStart & { enabled?: boolean; disabled?: boolean; onError: (message: string) => void; onBusyChange?: (busy: boolean) => void };
export function GoogleSigninButton({ enabled, disabled, intent, returnTo, onError, onBusyChange }: GoogleSigninButtonProps) {
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
  return <ActionButton secondary disabled={disabled || !enabled || !supported} busy={busy} label={!enabled ? t('auth.googleUnavailable') : !supported ? t('auth.googleBuild') : t(intent === 'link' ? 'auth.googleLink' : 'auth.google')} onPress={() => void signIn()} />;
}
