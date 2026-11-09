import { Redirect, useIsFocused } from 'expo-router';
import { Notifications } from '@/components/Notifications.component';
import { useNotifications } from '@/src/lib/Notifications.hook';
function NotificationsContent() {
  const view = useNotifications();
  return view.signedOut ? <Redirect href="/" /> : <Notifications {...view} />;
}
export default function NotificationsRoute() { return useIsFocused() ? <NotificationsContent /> : null; }
