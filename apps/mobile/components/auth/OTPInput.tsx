import { useAppLocale } from '@/src/i18n/LocaleContext';
import { Platform } from 'react-native';
import { TextField } from '../TextField';
export function OTPInput({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { t } = useAppLocale();
  return <TextField label={t('auth.code')} accessibilityLabel={t('auth.codeLabel')} editable={!disabled} identifier style={{ textAlign: 'center', fontSize: 28, letterSpacing: 6 }} autoFocus keyboardType="number-pad" textContentType="oneTimeCode" autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'} maxLength={6} value={value} onChangeText={code => onChange(code.replace(/\D/g, '').slice(0, 6))} placeholder="000000" />;
}
