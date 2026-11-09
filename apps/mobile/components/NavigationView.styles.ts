import { StyleSheet } from 'react-native';
export const navigationViewStyles = StyleSheet.create({
  centered: { textAlign: 'center' },
  // Centred on the row itself, so what sits on either side cannot push the name off centre.
  title: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
});
