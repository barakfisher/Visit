import { TextInput, View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { ActionButton } from './ActionButton';
import { AppText as Text } from './AppText';
import { useContactPhone } from './ContactPhone.hook';

export type ContactPhoneViewProps = ReturnType<typeof useContactPhone>;

/** The profile's phone field: an unverified number only its owner sees, never a way to sign in. */
export function ContactPhoneView({ t, draft, setDraft, save, status, invalid, canSave, removing }: ContactPhoneViewProps) {
  const saving = status === 'saving';
  return <View testID="contact-phone" className="gap-3 rounded-card border border-line bg-surface p-card">
    <Text accessibilityRole="header" className="font-semibold text-ink">{t('contactPhone.title')}</Text>
    <Text className="text-sm leading-5 text-body">{t('contactPhone.note')}</Text>
    <TextInput testID="contact-phone-input" value={draft} onChangeText={setDraft} onSubmitEditing={() => void save()} editable={!saving}
      accessibilityLabel={t('contactPhone.title')} aria-invalid={invalid} autoComplete="tel" textContentType="telephoneNumber" keyboardType="phone-pad" autoCorrect={false}
      placeholder="050-1234567" placeholderTextColor={tokens.color.disabled} style={{ writingDirection: 'ltr', textAlign: 'left' }}
      className={`rounded-control border px-4 py-4 text-ink ${invalid ? 'border-danger' : 'border-line'}`} />
    {invalid ? <Text accessibilityRole="alert" className="text-sm text-danger">{t('contactPhone.invalid')}</Text> : null}
    {status === 'failed' ? <Text accessibilityRole="alert" className="text-sm text-danger">{t('contactPhone.failed')}</Text> : null}
    {status === 'saved' ? <Text role="status" className="text-sm text-brand">{t('contactPhone.saved')}</Text> : null}
    <ActionButton secondary danger={removing} disabled={!canSave} busy={saving} label={t(removing ? 'contactPhone.remove' : 'contactPhone.save')} onPress={() => void save()} />
  </View>;
}

export function ContactPhone(props: Parameters<typeof useContactPhone>[0]) { return <ContactPhoneView {...useContactPhone(props)} />; }
