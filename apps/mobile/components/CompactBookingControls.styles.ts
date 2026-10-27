import { StyleSheet } from 'react-native';
export const compactBookingStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', justifyContent: 'center', alignItems: 'center', padding: 12 },
  panel: { width: '100%', maxWidth: 480, maxHeight: '90%', backgroundColor: '#fff', borderRadius: 20 },
  panelContent: { padding: 16, gap: 12 },
  choices: { gap: 8 },
  calendar: { width: 336, flexGrow: 1 },
  weekday: { width: '14.2857%', textAlign: 'center' },
  cell: { width: '14.2857%', padding: 2 },
  blank: { minHeight: 44 },
  identifier: { writingDirection: 'ltr', textAlign: 'left' },
});
