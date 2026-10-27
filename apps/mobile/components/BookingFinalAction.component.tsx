import { ActionButton } from './ActionButton';
import type { BookingFinalActionProps } from '../src/types/BookingFinalAction.types';
export function BookingFinalAction({ label, busy, disabled, onConfirm }: BookingFinalActionProps) {
  return <ActionButton label={label} busy={busy} disabled={disabled} onPress={() => void onConfirm()} />;
}
