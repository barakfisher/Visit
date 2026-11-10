import { useCancellationPrompt } from '../state/CancellationPrompt.store';

/** Asks in the cancellation sheet the root layout keeps mounted; resolves true only when the customer confirms. */
export function confirmAppointmentCancellation() {
  return useCancellationPrompt.getState().ask();
}
