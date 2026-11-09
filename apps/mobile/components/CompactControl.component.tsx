import type { ReactNode } from 'react';
import { View, type PressableProps } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { Control } from './Control';

const OVERHANG = (tokens.layout.minTouchTarget - tokens.layout.actionHeight) / 2;

/**
 * Looks actionHeight tall while its target stays minTouchTarget tall: the control overhangs the gap around it
 * by negative margins, so a smaller button costs neither finger room nor extra spacing.
 */
export function CompactControl({ surfaceClassName, children, ...props }: Omit<PressableProps, 'style' | 'children'> & { className?: string; surfaceClassName: (pressed: boolean) => string; children: ReactNode }) {
  return <Control {...props} style={{ marginVertical: -OVERHANG, justifyContent: 'center' }}>
    {({ pressed }) => <View style={{ minHeight: tokens.layout.actionHeight }} className={surfaceClassName(pressed)}>{children}</View>}
  </Control>;
}
