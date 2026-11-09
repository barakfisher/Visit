import { View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { AppText } from './AppText';
import { Control } from './Control';
import { BellIcon } from './NavigationIcons.component';

const BADGE_SIZE = 18;

/** The circle sits over the bell's top corner on the side the reader finishes on; with nothing unread there is none. */
export function NotificationBell({ label, badge, onPress }: { label: string; badge: string | null; onPress: () => void }) {
  return <Control testID="notification-bell" accessibilityRole="button" accessibilityLabel={label} onPress={onPress} className="items-center justify-center rounded-control active:bg-brand-soft">
    <BellIcon color={tokens.color.brand} />
    {badge ? <View testID="notification-badge" pointerEvents="none" style={{ position: 'absolute', top: 2, end: 0, minWidth: BADGE_SIZE, height: BADGE_SIZE, paddingHorizontal: 4, borderRadius: BADGE_SIZE / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: tokens.color.danger }}>
      <AppText style={{ fontSize: 11, lineHeight: 14 }} className="font-semibold text-white">{badge}</AppText>
    </View> : null}
  </Control>;
}
