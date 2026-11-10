import { View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { appointmentCancellationCopy } from '@/src/i18n/cancellationConfirm';
import { useCancellationPrompt } from '@/src/state/CancellationPrompt.store';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { FormDialog } from './FormDialog';

/** The cancel question, asked in the same sheet as the booking's final consent; closing it in any way keeps the appointment. */
export function CancellationPrompt() {
  const { locale } = useAppLocale();
  const open = useCancellationPrompt(state => state.pending !== null);
  const answer = useCancellationPrompt(state => state.answer);
  const copy = appointmentCancellationCopy(locale);
  return <FormDialog testID="cancellation-prompt" title={copy.title} open={open} onClose={() => answer(false)}>
    <AppText className="text-body">{copy.message}</AppText>
    <View className="gap-3 pt-2">
      <ActionButton danger label={copy.cancel} onPress={() => answer(true)} />
      <ActionButton secondary label={copy.keep} onPress={() => answer(false)} />
    </View>
  </FormDialog>;
}
