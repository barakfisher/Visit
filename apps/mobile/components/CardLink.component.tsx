import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Control } from './Control';

/**
 * A card the whole of which opens something, while its own buttons stay separate controls.
 * The link is a layer under the content, not a parent of it: a button inside a link is invalid on web, and a mis-tap
 * risk on a phone. Pressing anywhere outside the buttons tints the whole card.
 * Static content must sit in `CardLink.Passive`, so a tap on text reaches the link underneath.
 */
export function CardLink({ label, onPress, className = '', contentClassName = 'gap-4 p-card', testID, children }: { label: string; onPress?: () => void; className?: string; contentClassName?: string; testID?: string; children: ReactNode }) {
  return <View testID={testID} className={`overflow-hidden rounded-card border border-line bg-surface ${className}`}>
    {onPress ? <Control accessibilityRole="link" accessibilityLabel={label} onPress={onPress} style={StyleSheet.absoluteFill} className="active:bg-brand-soft" /> : null}
    <View pointerEvents="box-none" className={contentClassName}>{children}</View>
  </View>;
}

/** Text and other content that a tap passes through to the card's link; the link's label already says it to screen readers. */
/** `hidden` when the link's label repeats this content; content the label leaves out (a note, an error) stays readable. */
CardLink.Passive = function Passive({ children, className = '', hidden = false }: { children: ReactNode; className?: string; hidden?: boolean }) {
  return <View pointerEvents="none" aria-hidden={hidden || undefined} className={className}>{children}</View>;
};
