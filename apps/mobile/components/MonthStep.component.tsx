import { Control } from './Control';
import { DirectionalChevron } from './DirectionalChevron.component';
import { tokens } from '@/src/design/tokens';

/** A month step is an arrow beside the month's name; its full name ("Next month") is for screen readers. */
export function MonthStep({ pointing, label, disabled, onPress }: { pointing: 'back' | 'forward'; label: string; disabled: boolean; onPress: () => void }) {
  return <Control accessibilityRole="button" accessibilityLabel={label} aria-disabled={disabled} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    className={`items-center justify-center rounded-control border ${disabled ? 'border-control-line' : 'border-brand active:bg-brand-soft'}`}>
    <DirectionalChevron pointing={pointing} color={disabled ? tokens.color.muted : tokens.color.brand} />
  </Control>;
}
