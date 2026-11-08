import type { ReactNode } from 'react';
import { ActivityIndicator } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { CompactControl } from './CompactControl.component';

/** A button with no visible text, sharing its row equally. The label is what assistive technology reads. */
export function IconButton({ label, onPress, disabled = false, busy = false, children }: { label: string; onPress?: () => void; disabled?: boolean; busy?: boolean; children: (color: string) => ReactNode }) {
  return <CompactControl accessibilityRole="button" accessibilityLabel={label} aria-busy={busy} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} className="flex-1" surfaceClassName={pressed => `items-center justify-center rounded-control border ${disabled ? 'border-control-line bg-canvas' : `border-brand ${pressed ? 'bg-brand-soft' : 'bg-surface'}`}`}>
    {busy ? <ActivityIndicator accessibilityLabel={label} color={tokens.color.brand} /> : children(disabled ? tokens.color.muted : tokens.color.brand)}
  </CompactControl>;
}
