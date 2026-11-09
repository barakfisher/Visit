import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { LAYOUT_MOTION } from '@/src/design/motion';

/**
 * Follows its content's height over time, so whatever sits below or beside it moves gradually instead of jumping.
 * The content is measured apart from the clip, because a clip that took its height from the content could not animate.
 */
export function SmoothHeight({ children, collapsed = false, onCollapsed }: { children: ReactNode; collapsed?: boolean; onCollapsed?: () => void }) {
  const [measured, setMeasured] = useState<number | null>(null);
  const target = collapsed ? 0 : measured ?? 0;
  const height = useSharedValue(target);
  const opacity = useSharedValue(collapsed ? 0 : 1);
  // Content already there when the screen appears takes its place at once; only later changes animate.
  const settled = useRef(false);
  useEffect(() => {
    if (measured === null) return;
    if (!settled.current) { settled.current = true; height.set(target); return; }
    height.set(withTiming(target, LAYOUT_MOTION, finished => { if (finished && collapsed && onCollapsed) scheduleOnRN(onCollapsed); }));
  }, [target, measured, collapsed, onCollapsed, height]);
  useEffect(() => { opacity.set(withTiming(collapsed ? 0 : 1, LAYOUT_MOTION)); }, [collapsed, opacity]);
  const clip = useAnimatedStyle(() => ({ height: height.get(), opacity: opacity.get() }), [height, opacity]);
  return <Animated.View style={[styles.clip, clip]}>
    <View aria-hidden={collapsed} pointerEvents={collapsed ? 'none' : 'auto'} style={styles.content} onLayout={event => setMeasured(event.nativeEvent.layout.height)}>{children}</View>
  </Animated.View>;
}

/** Shows content while there is some, and keeps the last of it on screen until it has finished collapsing away. */
export function SmoothReveal({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(children);
  if (children && children !== shown) setShown(children);
  return <SmoothHeight collapsed={!children} onCollapsed={() => setShown(null)}>{children || shown}</SmoothHeight>;
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  content: { position: 'absolute', top: 0, left: 0, right: 0 },
});
