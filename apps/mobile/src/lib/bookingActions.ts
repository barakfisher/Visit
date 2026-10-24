import { Alert, Platform } from 'react-native';

export function confirmAppointmentCancellation() {
  if (Platform.OS === 'web') return Promise.resolve(typeof window !== 'undefined' && window.confirm('Cancel this appointment?'));
  return new Promise<boolean>((resolve) => {
    Alert.alert('Cancel appointment?', 'Your appointment will be released after you confirm.', [
      { text: 'Keep appointment', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Cancel appointment', style: 'destructive', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}
