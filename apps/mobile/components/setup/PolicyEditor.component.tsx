import { Switch, View } from 'react-native';
import { AppText } from '../AppText';
import { TextField } from '../TextField';
import { ActionButton } from '../ActionButton';
import { labels, contacts, type NumericKey } from './PolicyEditor.types';
import type { usePolicyForm } from './PolicyEditor.hook';
import { advanceHint, noticeHint, verifiedPhoneSwitch } from '@/src/lib/BookingPolicyForm';
const hints: Partial<Record<NumericKey, typeof noticeHint>> = { minimumNoticeMinutes: noticeHint, maximumAdvanceDays: advanceHint };
export function PolicyFormView(props: ReturnType<typeof usePolicyForm>) {
  const { t, values, setValues, requirements, setRequirements, sms, busy, feedback, save } = props;
  const phone = verifiedPhoneSwitch(sms, requirements.requireVerifiedPhone);
  return <View className="gap-4"><AppText>{t('setup.policyHint')}</AppText>{(Object.keys(labels) as (NumericKey)[]).map(key => { const hint = hints[key]?.(values[key]); return <TextField key={key} label={t(labels[key])} hint={hint ? t(hint.key, hint.values) : undefined} identifier keyboardType="number-pad" value={values[key]} onChangeText={value => setValues(v => ({ ...v, [key]: value }))} />; })}{contacts.map(key => { const hint = key === 'requireVerifiedPhone' ? phone.hint : null; return <View key={key} className="gap-1"><View className="flex-row items-center justify-between gap-3"><AppText>{t(`bookingContact.${key}`)}</AppText><Switch accessibilityLabel={t(`bookingContact.${key}`)} accessibilityHint={hint ? t(hint) : undefined} disabled={busy || (key === 'requireVerifiedPhone' && phone.disabled)} value={requirements[key]} onValueChange={value => setRequirements(previous => ({ ...previous, [key]: value }))} /></View>{hint ? <AppText accessibilityRole={requirements[key] ? 'alert' : undefined} className={requirements[key] ? 'text-danger' : 'text-body'}>{t(hint)}</AppText> : null}</View>; })}<ActionButton label={t('setup.savePolicy')} busy={busy} onPress={() => void save()} />{feedback ? <AppText accessibilityRole={feedback.saved ? 'status' : 'alert'}>{t(feedback.key)}</AppText> : null}</View>;
}
