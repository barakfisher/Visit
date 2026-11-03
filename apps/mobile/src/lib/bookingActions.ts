import { Alert, Platform } from 'react-native';
import { appointmentCancellationCopy, webCancellationPrompt } from '../i18n/cancellationConfirm';
import type { Locale } from '../i18n/messages';

export function confirmAppointmentCancellation(locale: Locale) {
  if (Platform.OS === 'web') return Promise.resolve(typeof window !== 'undefined' && window.confirm(webCancellationPrompt(locale)));
  const copy = appointmentCancellationCopy(locale);
  return new Promise<boolean>((resolve) => {
    Alert.alert(copy.title, copy.message, [
      { text: copy.keep, style: 'cancel', onPress: () => resolve(false) },
      { text: copy.cancel, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
