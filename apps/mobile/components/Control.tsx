import { useState } from 'react';
import { Platform, Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { tokens } from '@/src/design/tokens';

/** Shared target sizing; native keyboard focus complements the web CSS ring. */
export function Control({ style, onFocus, onBlur, ...props }: Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle> }) {
  const [focused, setFocused] = useState(false);
  return <Pressable {...props} onFocus={event => { setFocused(true); onFocus?.(event); }} onBlur={event => { setFocused(false); onBlur?.(event); }} style={[
    { minHeight: tokens.layout.minTouchTarget, minWidth: tokens.layout.minTouchTarget },
    style,
    Platform.OS !== 'web' && focused ? { borderColor: tokens.color.focus, borderWidth: tokens.interaction.focusWidth } : null,
  ]} />;
}
