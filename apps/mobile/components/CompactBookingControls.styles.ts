import { StyleSheet } from 'react-native';
import { tokens } from '@/src/design/tokens';
const WEEK_DAYS = 7;
const DAY_GUTTER = 1;
// Seven minimum touch targets plus gutters; below this the calendar grid scrolls horizontally.
export const CALENDAR_MIN_WIDTH = WEEK_DAYS * (tokens.layout.minTouchTarget + 2 * DAY_GUTTER);
export const compactBookingStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', justifyContent: 'center', alignItems: 'center', padding: 8 },
  panel: { width: '100%', maxWidth: 480, maxHeight: '90%', backgroundColor: '#fff', borderRadius: 20 },
  panelContent: { padding: 16, gap: 12 },
  choices: { gap: 8 },
  weekday: { width: '14.2857%', textAlign: 'center' },
  cell: { width: '14.2857%', paddingHorizontal: DAY_GUTTER, paddingVertical: 2 },
  blank: { minHeight: 44 },
  identifier: { writingDirection: 'ltr', textAlign: 'left' },
});
