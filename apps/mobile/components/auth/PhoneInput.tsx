import { AppText as Text } from '../AppText';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { TextInput, View } from 'react-native';
export function PhoneInput({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const { t } = useAppLocale();
  return <View className="gap-2"><Text className="font-medium text-ink">{t('auth.phone')}</Text><TextInput style={{ writingDirection: 'ltr', textAlign: 'left' }} accessibilityLabel={t('auth.phone')} autoComplete="tel" textContentType="telephoneNumber" keyboardType="phone-pad" autoCapitalize="none" value={value} onChangeText={(next) => onChange(next.replace(/[^+\d]/g, ''))} editable={!disabled} placeholder="+972 50 123 4567" className={`rounded-control border border-line px-4 py-4 text-ink ${disabled ? 'bg-canvas opacity-50' : 'bg-surface'}`} /><Text className="text-xs leading-5 text-muted">{t('auth.phoneHint')}</Text></View>;
}
