import { Switch, View } from 'react-native';
import { AppText } from '../AppText';
import { TextField } from '../TextField';
import { ActionButton } from '../ActionButton';
import { labels, contacts, type NumericKey } from './PolicyEditor.types';
import type { usePolicyForm } from './PolicyEditor.hook';
export function PolicyFormView(props: ReturnType<typeof usePolicyForm>) {
  const { t, values, setValues, requirements, setRequirements, busy, feedback, save } = props;
  return <View className="gap-4"><AppText>{t('setup.policyHint')}</AppText>{(Object.keys(labels) as (NumericKey)[]).map(key => <TextField key={key} label={t(labels[key])} identifier keyboardType="number-pad" value={values[key]} onChangeText={value => setValues(v => ({ ...v, [key]: value }))} />)}{contacts.map(key => <View key={key} className="flex-row items-center justify-between gap-3"><AppText>{t(`bookingContact.${key}`)}</AppText><Switch accessibilityLabel={t(`bookingContact.${key}`)} disabled={busy} value={requirements[key]} onValueChange={value => setRequirements(previous => ({ ...previous, [key]: value }))} /></View>)}<ActionButton label={t('setup.savePolicy')} busy={busy} onPress={() => void save()} />{feedback ? <AppText accessibilityRole={feedback === 'saved' ? 'status' : 'alert'}>{t(feedback === 'saved' ? 'setup.saved' : feedback === 'numbers' ? 'setup.numbers' : 'setup.saveFailure')}</AppText> : null}</View>;
}
