import { ScreenContent } from '@/components/ScreenContent';
import { Link, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { safeAuthReturnTo } from '@visit/contracts';
import { usePasswordSignIn } from '@/src/lib/PasswordSignIn.hook';
import { PasswordSignIn } from '@/components/auth/PasswordSignIn.component';
import { AuthHeader } from '@/components/auth/AuthHeader.component';

// Customers and providers sign up the same way; a provider then applies for a business.
export default function SignUpScreen() {
  const { t } = useAppLocale();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = safeAuthReturnTo(params.returnTo);
  const password = usePasswordSignIn('sign-up', returnTo);
  return <KeyboardAvoidingView className="flex-1 bg-canvas" behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="flex-grow justify-center px-5 py-10"><ScreenContent form className="gap-6 rounded-card border border-line bg-surface">
    <AuthHeader title={t('password.signUpTitle')} intro={t('password.signUpIntro')} />
    <PasswordSignIn {...password} />
    <Link href={{ pathname: '/auth/login', params: returnTo ? { returnTo } : {} }} onPress={event => { if (password.busy) event.preventDefault(); }} className="min-h-touch py-3 text-center font-semibold text-brand">{t('password.toSignIn')}</Link>
  </ScreenContent></ScrollView></KeyboardAvoidingView>;
}
