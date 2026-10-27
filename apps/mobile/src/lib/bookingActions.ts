import { Alert, Platform } from 'react-native';

export function confirmAppointmentCancellation(copy = { title: 'Cancel this appointment?', message: 'Your appointment will be released after you confirm.', keep: 'Keep appointment', cancel: 'Cancel appointment' }) {
  if (Platform.OS === 'web') return Promise.resolve(typeof window !== 'undefined' && window.confirm(copy.title));
  return new Promise<boolean>((resolve) => {
    Alert.alert(copy.title, copy.message, [
      { text: copy.keep, style: 'cancel', onPress: () => resolve(false) },
      { text: copy.cancel, style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
