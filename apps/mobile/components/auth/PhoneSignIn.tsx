import { View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { isolateLtr } from '@/src/i18n/messages';
import { AppText } from '../AppText';
import { ActionButton } from '../ActionButton';
import { OTPInput } from './OTPInput';
import { PhoneInput } from './PhoneInput';
export type PhoneSignInProps = { enabled: boolean; blocked?: boolean; phone: string; code: string; sent: boolean; busy: boolean; error: string; issued: boolean; cooldown: number; remaining: number; setPhone: (value: string) => void; setCode: (value: string) => void; send: () => void; verify: () => void; reset: () => void };
export function PhoneSignIn({ enabled, blocked, phone, code, sent, busy, error, issued, cooldown, remaining, setPhone, setCode, send, verify, reset }: PhoneSignInProps) {
  const { t } = useAppLocale();
  const disabled = busy || blocked;
  return <View className="gap-4">
    {issued ? <>
      <AppText className="text-body">{t('auth.issuedHelp')}</AppText>
      <ActionButton label={t('auth.resume')} onPress={verify} busy={busy} disabled={blocked} />
      <ActionButton secondary label={t('auth.restart')} onPress={reset} disabled={disabled} />
    </> : sent ? <>
      <AppText className="text-body">{t('auth.codeSent', { phone: isolateLtr(phone) })}</AppText>
      <OTPInput value={code} onChange={setCode} disabled={disabled || !remaining} />
      <AppText accessibilityRole={remaining ? 'timer' : 'status'} className="text-sm text-body">{remaining ? t('auth.expiresIn', { seconds: remaining }) : t('auth.expired')}</AppText>
      <ActionButton label={t('auth.verify')} onPress={verify} busy={busy} disabled={blocked || !remaining || code.length !== 6} />
      <ActionButton secondary label={cooldown ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resend')} onPress={send} disabled={disabled || cooldown > 0} />
      <ActionButton secondary label={t('auth.changePhone')} onPress={reset} disabled={disabled} />
    </> : <>
      <PhoneInput value={phone} onChange={setPhone} disabled={!enabled || disabled} />
      <ActionButton label={!enabled ? t('auth.smsUnavailable') : cooldown ? t('auth.resendIn', { seconds: cooldown }) : t('auth.sendCode')} onPress={send} busy={busy} disabled={!enabled || blocked || cooldown > 0 || !/^\+[1-9]\d{7,14}$/.test(phone)} />
    </>}
    {error ? <AppText accessibilityRole="alert" className="text-sm text-danger">{error}</AppText> : null}
  </View>;
}
