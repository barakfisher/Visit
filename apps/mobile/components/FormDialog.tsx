import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Modal, PanResponder, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tokens } from '@/src/design/tokens';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText } from './AppText';

/** Long enough to read as motion, short enough not to keep anyone waiting; Reanimated skips it under reduce motion. */
const SHEET_MOTION = { duration: 260, easing: Easing.out(Easing.cubic) };
/** How far a sheet travels in from below; it is under the screen edge before it starts, whatever its own height. */
const SHEET_TRAVEL = 600;
// The panel moves but never fades: its text keeps full contrast at every frame, and only the backdrop fades.
const DIALOG_SCALE_FROM = 0.96;
const DIALOG_TRAVEL = 16;
/** A downward drag past this distance, or a flick faster than this speed (points per ms), closes a sheet. */
export const SHEET_DISMISS_DISTANCE = 96;
export const SHEET_DISMISS_VELOCITY = 0.8;
/** A drag counts as one only once it has moved this far, mostly downwards: a tap or a sideways move stays a tap. */
const SHEET_DRAG_START = 8;

/**
 * A form over the current screen: a bottom sheet on phones, a centred dialog from the compact breakpoint up.
 * It slides (or rises) in, and stays mounted while it leaves, so closing is as smooth as opening.
 * Tapping the backdrop closes it, the same as Escape or the Android back button; a sheet also closes when dragged
 * down from its handle, or from its content while that is scrolled to the top (decisions.md, "Block time simpler, sheets close with a swipe down" — 2026-11-11).
 */
export function FormDialog({ title, open, onClose, testID, children }: { title: string; open: boolean; onClose: () => void; testID?: string; children: ReactNode }) {
  const { direction, t } = useAppLocale();
  const compact = useWindowDimensions().width < tokens.layout.compactBreakpoint;
  const [mounted, setMounted] = useState(open);
  // The last content stays on screen while the sheet leaves, instead of emptying under the animation.
  const [kept, setKept] = useState({ title, children });
  if (open && (kept.title !== title || kept.children !== children)) setKept({ title, children });
  const shown = open ? { title, children } : kept;
  const progress = useSharedValue(0);
  // How far the sheet follows a finger down; it springs back unless the drag closes it.
  const drag = useSharedValue(0);
  // Whether the content is scrolled to the top, read by the gesture as it starts; it never needs a render.
  const scrollTop = useSharedValue(true);
  const swipe = useMemo(() => {
    const downwards = (dx: number, dy: number) => dy > SHEET_DRAG_START && dy > Math.abs(dx) * 1.5;
    return PanResponder.create({
      // Taken from the content only while it is scrolled to the top, so a scroll up the list is still a scroll.
      onMoveShouldSetPanResponderCapture: (_, { dx, dy }) => scrollTop.get() && downwards(dx, dy),
      onMoveShouldSetPanResponder: (_, { dx, dy }) => downwards(dx, dy),
      onPanResponderMove: (_, { dy }) => drag.set(Math.max(0, dy)),
      onPanResponderRelease: (_, { dy, vy }) => {
        if (dy > SHEET_DISMISS_DISTANCE || vy > SHEET_DISMISS_VELOCITY) onClose();
        else drag.set(withTiming(0, SHEET_MOTION));
      },
      onPanResponderTerminate: () => drag.set(withTiming(0, SHEET_MOTION)),
    });
  }, [drag, scrollTop, onClose]);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (!mounted) return;
    progress.set(withTiming(open ? 1 : 0, SHEET_MOTION));
    if (open) { drag.set(0); return; }
    // Unmounting waits on a timer, not on the animation's callback: a callback that never arrived left an invisible
    // backdrop over the whole app (seen in the browser suite). Reopening before it fires cancels it.
    const leave = setTimeout(() => setMounted(false), SHEET_MOTION.duration);
    return () => clearTimeout(leave);
  }, [open, mounted, progress, drag]);
  const backdrop = useAnimatedStyle(() => ({ opacity: progress.get() }), [progress]);
  const panel = useAnimatedStyle(() => compact
    ? { transform: [{ translateY: (1 - progress.get()) * SHEET_TRAVEL + drag.get() }] }
    : { transform: [{ translateY: (1 - progress.get()) * DIALOG_TRAVEL }, { scale: DIALOG_SCALE_FROM + (1 - DIALOG_SCALE_FROM) * progress.get() }] }, [progress, drag, compact]);
  if (!mounted) return null;
  return <Modal transparent visible animationType="none" accessibilityLabel={shown.title} onRequestClose={onClose}>
    {/* A leaving sheet takes no taps: the screen under it is usable again at once. */}
    <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, styles.backdrop, backdrop]}>
      <Pressable testID={testID ? `${testID}-backdrop` : undefined} accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={open ? onClose : undefined} style={StyleSheet.absoluteFill} />
    </Animated.View>
    <Animated.View pointerEvents="box-none" style={[styles.layout, compact ? styles.sheetLayout : styles.dialogLayout, { direction }]}>
      <Animated.View pointerEvents={open ? 'auto' : 'none'} style={[styles.panel, compact ? styles.sheet : styles.dialog, panel]} {...(compact ? swipe.panHandlers : {})}>
        {/* The handle says the sheet can be pulled down; it is decoration, since the backdrop and Escape close it too. */}
        {compact ? <View testID={testID ? `${testID}-handle` : undefined} accessible={false} importantForAccessibility="no-hide-descendants" style={styles.handleArea}><View style={styles.handle} /></View> : null}
        <SafeAreaView testID={open ? testID : undefined} edges={compact ? ['bottom'] : []} style={{ direction, flexShrink: 1 }}>
          <ScrollView accessibilityViewIsModal keyboardShouldPersistTaps="handled" scrollEventThrottle={16} onScroll={event => scrollTop.set(event.nativeEvent.contentOffset.y <= 0)} contentContainerStyle={compact ? styles.sheetContent : styles.content}>
            <AppText accessibilityRole="header" className="text-xl font-bold text-ink">{shown.title}</AppText>
            {shown.children}
          </ScrollView>
        </SafeAreaView>
      </Animated.View>
    </Animated.View>
  </Modal>;
}
const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(15,23,42,0.35)' },
  layout: { flex: 1 },
  sheetLayout: { justifyContent: 'flex-end' },
  dialogLayout: { justifyContent: 'center', alignItems: 'center', padding: 24 },
  panel: { backgroundColor: tokens.color.surface, maxHeight: '92%', overflow: 'hidden' },
  sheet: { width: '100%', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  dialog: { width: '100%', maxWidth: tokens.layout.formMaxWidth + 64, borderRadius: 24 },
  content: { padding: 20, gap: 12 },
  sheetContent: { paddingHorizontal: 20, paddingBottom: 20, paddingTop: 4, gap: 12 },
  handleArea: { alignItems: 'center', paddingTop: 10, paddingBottom: 6 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: tokens.color.line },
});
