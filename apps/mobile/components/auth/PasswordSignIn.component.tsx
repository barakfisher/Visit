import { View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText } from '../AppText';
import { ActionButton } from '../ActionButton';
import { TextField } from '../TextField';
import type { PasswordSignInView } from '@/src/types/PasswordSignIn.types';
export function PasswordSignIn({ blocked = false, ...view }: PasswordSignInView & { blocked?: boolean }) {
  const { t } = useAppLocale();
  const signUp = view.mode === 'sign-up', editable = !view.busy && !blocked;
  return <View className="gap-4">
    {signUp ? <TextField label={t('password.name')} autoComplete="name" textContentType="name" placeholder={t('password.namePlaceholder')} value={view.displayName} editable={editable} onChangeText={view.setDisplayName} /> : null}
    <TextField label={t('password.email')} identifier autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" keyboardType="email-address" placeholder="you@example.com" value={view.email} editable={editable} onChangeText={view.setEmail} />
    <TextField label={t('password.password')} hint={signUp ? t('password.passwordHint') : undefined} identifier secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete={signUp ? 'new-password' : 'current-password'} textContentType={signUp ? 'newPassword' : 'password'} value={view.password} editable={editable} onChangeText={view.setPassword} onSubmitEditing={blocked ? undefined : view.submit} />
    <ActionButton label={t(signUp ? 'password.signUp' : 'password.signIn')} busy={view.busy} disabled={blocked || !view.canSubmit} onPress={view.submit} />
    {view.error ? <AppText accessibilityRole="alert" className="text-sm text-danger">{view.error}</AppText> : null}
  </View>;
}
