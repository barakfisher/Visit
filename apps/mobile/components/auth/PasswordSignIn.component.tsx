import { View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { isolateLtr } from '@/src/i18n/messages';
import { AppText } from '../AppText';
import { ActionButton } from '../ActionButton';
import { TextField } from '../TextField';
import { OTPInput } from './OTPInput';
import type { PasswordSignInView, SignUpCodeStep } from '@/src/types/PasswordSignIn.types';
export function PasswordSignIn({ blocked = false, ...view }: PasswordSignInView & { blocked?: boolean }) {
  const { t } = useAppLocale();
  const signUp = view.mode === 'sign-up', editable = !view.busy && !blocked;
  if (view.codeStep) return <SignUpCode step={view.codeStep} busy={view.busy} blocked={blocked} error={view.error} />;
  return <View className="gap-4">
    {signUp ? <TextField label={t('password.name')} autoComplete="name" textContentType="name" placeholder={t('password.namePlaceholder')} value={view.displayName} editable={editable} onChangeText={view.setDisplayName} /> : null}
    <TextField label={t('password.email')} identifier autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" keyboardType="email-address" placeholder="you@example.com" value={view.email} editable={editable} onChangeText={view.setEmail} />
    <TextField label={t('password.password')} hint={signUp ? t('password.passwordHint') : undefined} identifier secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={signUp ? 'new-password' : 'current-password'} textContentType={signUp ? 'newPassword' : 'password'} value={view.password} editable={editable} onChangeText={view.setPassword} onSubmitEditing={blocked ? undefined : view.submit} />
    <ActionButton label={t(signUp ? 'password.signUp' : 'password.signIn')} busy={view.busy} disabled={blocked || !view.canSubmit} onPress={view.submit} />
    {view.error ? <AppText accessibilityRole="alert" className="text-sm text-danger">{view.error}</AppText> : null}
  </View>;
}

/** Sign-up's second step, on the same screen: the code sent to the address creates the account. */
function SignUpCode({ step, busy, blocked, error }: { step: SignUpCodeStep; busy: boolean; blocked: boolean; error: string }) {
  const { t } = useAppLocale();
  const disabled = busy || blocked;
  return <View className="gap-4">
    {step.issued ? <>
      <AppText className="text-body">{t('auth.issuedHelp')}</AppText>
      <ActionButton label={t('auth.resume')} onPress={step.verify} busy={busy} disabled={blocked} />
    </> : <>
      <AppText className="text-body">{t('password.codeSent', { email: isolateLtr(step.email) })}</AppText>
      <OTPInput value={step.code} onChange={step.setCode} disabled={disabled || step.needsNewCode} />
      {step.needsNewCode ? null : <AppText role="timer" className="text-sm text-body">{t('auth.expiresIn', { seconds: step.remaining })}</AppText>}
      <ActionButton label={t('password.verify')} onPress={step.verify} busy={busy} disabled={blocked || step.needsNewCode || step.code.length !== 6} />
      <ActionButton secondary label={step.cooldown ? t('auth.resendIn', { seconds: step.cooldown }) : t('auth.resend')} onPress={step.resend} disabled={disabled || step.cooldown > 0} />
      <ActionButton secondary label={t('password.changeEmail')} onPress={step.changeEmail} disabled={disabled} />
      <AppText className="text-sm text-muted">{t('password.codeHelp')}</AppText>
    </>}
    {error ? <AppText accessibilityRole="alert" className="text-sm text-danger">{error}</AppText>
      : step.needsNewCode && !step.issued ? <AppText role="status" className="text-sm text-danger">{t('password.codeExpired')}</AppText> : null}
  </View>;
}
