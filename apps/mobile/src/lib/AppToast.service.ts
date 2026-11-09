import Toast from 'react-native-toast-message';

export function showSuccessToast(message: string) { Toast.show({ type: 'success', text1: message }); }
