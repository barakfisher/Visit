import { StyleSheet } from 'react-native';
export const navigationViewStyles = StyleSheet.create({
  centered: { textAlign: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)', alignItems: 'flex-start' },
  panel: { width: '88%', maxWidth: 360, flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, gap: 12 },
});
