import { View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { isolateLtr } from '@/src/i18n/messages';
import { AppText } from '../AppText';
import { ActionButton } from '../ActionButton';
import { OTPInput } from './OTPInput';
import type { SignUpCodeView } from '@/src/types/PasswordSignIn.types';
// The code step of sign-up: the account exists only after the emailed code is right.
export function SignUpCode(view: SignUpCodeView & { onSignIn: () => void }) {
  const { t } = useAppLocale();
  return <View className="gap-4">
    {view.issued ? <>
      <AppText className="text-body">{t('auth.issuedHelp')}</AppText>
      <ActionButton label={t('auth.resume')} onPress={view.verify} busy={view.busy} />
    </> : <>
      <View className="gap-1">
        <AppText className="text-body">{t('signUp.codeSent')}</AppText>
        {/* The address on its own line, left to right, so it never breaks inside a Hebrew sentence. */}
        <AppText testID="sign-up-email" className="font-semibold text-ink">{isolateLtr(view.email)}</AppText>
      </View>
      <OTPInput value={view.code} onChange={view.setCode} disabled={view.busy || view.ended} />
      <ActionButton label={t('signUp.verify')} onPress={view.verify} busy={view.busy} disabled={view.ended || view.code.length !== 6} />
      {__DEV__ && !view.ended ? <ActionButton secondary label={t('signUp.localCode')} disabled={view.busy} onPress={view.loadLocalCode} /> : null}
      {view.error ? <AppText accessibilityRole="alert" className="text-sm text-danger">{view.error}</AppText> : null}
      {view.localNotice ? <AppText role="status" className="text-sm text-body">{view.localNotice}</AppText> : null}
      {view.accountExists ? <ActionButton label={t('password.signIn')} onPress={view.onSignIn} /> : null}
      {view.ended ? null : <ActionButton secondary label={view.cooldown ? t('auth.resendIn', { seconds: view.cooldown }) : t('auth.resend')} onPress={view.resend} disabled={view.busy || view.cooldown > 0} />}
      <ActionButton secondary label={t(view.ended ? 'signUp.startOver' : 'signUp.changeAddress')} onPress={view.changeAddress} disabled={view.busy} />
    </>}
  </View>;
}
