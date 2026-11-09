import Toast from 'react-native-toast-message';

/** A refusal is read, not glanced at, so it stays longer than the library's four-second default. */
export const REFUSAL_TOAST_MS = 6000;

export function showSuccessToast(message: string) { Toast.show({ type: 'success', text1: message }); }
export function showRefusalToast(message: string) { Toast.show({ type: 'refusal', text1: message, visibilityTime: REFUSAL_TOAST_MS }); }
export function hideToast() { Toast.hide(); }
