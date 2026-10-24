import { useAppLocale } from '@/src/i18n/LocaleContext';
import { useState } from 'react';
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { ActionButton } from '../ActionButton';
export type GoogleSigninButtonProps = { enabled?: boolean; onCredential: (idToken: string) => void; onError: (message: string) => void };
export function GoogleSigninButton({ enabled, onCredential, onError }: GoogleSigninButtonProps) {
  const { t } = useAppLocale();
  const [busy, setBusy] = useState(false);
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const expoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  const configured = enabled && webClientId && (Platform.OS !== 'ios' || iosClientId);
  async function signIn() {
    setBusy(true);
    try {
      const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
      GoogleSignin.configure({ webClientId, ...(iosClientId ? { iosClientId } : {}) });
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      if (response.type === 'success' && response.data.idToken) onCredential(response.data.idToken);
    } catch { onError(t('auth.failure')); }
    finally { setBusy(false); }
  }
  return <ActionButton secondary disabled={!configured || expoGo} busy={busy} label={!configured ? t('auth.googleUnavailable') : expoGo ? t('auth.googleBuild') : t('auth.google')} onPress={() => void signIn()} />;
}
