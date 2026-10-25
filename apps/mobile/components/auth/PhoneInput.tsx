import { useAppLocale } from '@/src/i18n/LocaleContext';
import { TextField } from '../TextField';
export function PhoneInput({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { t } = useAppLocale();
  return <TextField label={t('auth.phone')} hint={t('auth.phoneHint')} identifier autoComplete="tel" textContentType="telephoneNumber" keyboardType="phone-pad" autoCapitalize="none" value={value} onChangeText={next => onChange(next.replace(/[^+\d]/g, ''))} editable={!disabled} placeholder="+972 50 123 4567" />;
}
