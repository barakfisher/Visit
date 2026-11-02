import type { ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tokens } from '@/src/design/tokens';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText } from './AppText';

/** A form over the current screen: a bottom sheet on phones, a centred dialog from the compact breakpoint up. */
export function FormDialog({ title, open, onClose, testID, children }: { title: string; open: boolean; onClose: () => void; testID?: string; children: ReactNode }) {
  const { direction } = useAppLocale();
  const compact = useWindowDimensions().width < tokens.layout.compactBreakpoint;
  if (!open) return null;
  return <Modal transparent visible animationType="none" accessibilityLabel={title} onRequestClose={onClose}>
    <View style={[styles.overlay, compact ? styles.sheetOverlay : styles.dialogOverlay, { direction }]}>
      <SafeAreaView testID={testID} edges={compact ? ['bottom'] : []} style={[styles.panel, compact ? styles.sheet : styles.dialog, { direction }]}>
        <ScrollView accessibilityViewIsModal keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <AppText accessibilityRole="header" className="text-xl font-bold text-ink">{title}</AppText>
          {children}
        </ScrollView>
      </SafeAreaView>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.35)' },
  sheetOverlay: { justifyContent: 'flex-end' },
  dialogOverlay: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  panel: { backgroundColor: tokens.color.surface, maxHeight: '92%' },
  sheet: { width: '100%', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  dialog: { width: '100%', maxWidth: tokens.layout.formMaxWidth + 64, borderRadius: 24 },
  content: { padding: 20, gap: 12 },
});
