import { ScreenContent } from '@/components/ScreenContent';
import { Link, router, useLocalSearchParams } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { safeAuthReturnTo } from '@visit/contracts';
import { usePasswordSignUp } from '@/src/lib/PasswordSignUp.hook';
import { PasswordSignIn } from '@/components/auth/PasswordSignIn.component';
import { SignUpCode } from '@/components/auth/SignUpCode.component';
import { AuthHeader } from '@/components/auth/AuthHeader.component';

// Customers and providers sign up the same way; a provider then applies for a business.
// The emailed code proves the address before the account exists (login-plan-stage-2.md, slice 1).
export default function SignUpScreen() {
  const { t } = useAppLocale();
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const returnTo = safeAuthReturnTo(params.returnTo);
  const signUp = usePasswordSignUp(returnTo);
  const signIn = { pathname: '/auth/login' as const, params: returnTo ? { returnTo } : {} };
  const coding = signUp.step === 'code';
  return <KeyboardAvoidingView className="flex-1 bg-canvas" behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="flex-grow justify-center px-5 py-10"><ScreenContent form className="gap-6 rounded-card border border-line bg-surface">
    <AuthHeader title={t(coding ? 'signUp.codeTitle' : 'password.signUpTitle')} intro={t(coding ? 'signUp.codeIntro' : 'password.signUpIntro')} />
    {coding ? <SignUpCode {...signUp.code} onSignIn={() => router.replace(signIn)} /> : <PasswordSignIn {...signUp.form} />}
    {coding ? null : <Link href={signIn} onPress={event => { if (signUp.form.busy) event.preventDefault(); }} className="min-h-touch py-3 text-center font-semibold text-brand">{t('password.toSignIn')}</Link>}
  </ScreenContent></ScrollView></KeyboardAvoidingView>;
}
