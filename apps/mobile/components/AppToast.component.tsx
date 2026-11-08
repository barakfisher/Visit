import { View } from 'react-native';
import Toast, { type ToastConfig } from 'react-native-toast-message';
import { AppText } from './AppText';

/** Clears the footer navigation, which the toast's host sits above. */
const TOAST_BOTTOM_OFFSET = 80;
const config: ToastConfig = {
  success: ({ text1 }) => <View role="status" accessibilityLiveRegion="polite" testID="app-toast" className="mx-5 max-w-md rounded-control bg-ink px-4 py-3">
    <AppText style={{ textAlign: 'center' }} className="font-semibold text-white">{text1}</AppText>
  </View>,
};

/** The one toast host. It sits above the navigator, so a message survives the route change it announces. */
export function AppToast() { return <Toast config={config} position="bottom" bottomOffset={TOAST_BOTTOM_OFFSET} />; }
