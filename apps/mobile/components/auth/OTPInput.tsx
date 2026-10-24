import { AppText as Text } from '../AppText';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { Platform, TextInput, View } from 'react-native';
export function OTPInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useAppLocale();
  return <View className="gap-2"><Text className="font-medium text-ink">{t('auth.code')}</Text><TextInput style={{ writingDirection: 'ltr', textAlign: 'center' }} autoFocus accessibilityLabel={t('auth.codeLabel')} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'} maxLength={6} value={value} onChangeText={(code) => onChange(code.replace(/\D/g, '').slice(0, 6))} placeholder="000000" className="rounded-control border border-line bg-surface px-4 py-4 text-center text-3xl tracking-widest text-ink" /></View>;
}
