export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthenticated = () => new AppError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
export const forbidden = () => new AppError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
export const notFound = () => new AppError(404, 'NOT_FOUND', 'The requested resource was not found.');
export const conflict = (message = 'The request conflicts with the current state.') => new AppError(409, 'CONFLICT', message);
// A customer's own appointment is inside the business's change window; distinct codes let clients explain why.
export const RESCHEDULE_CUTOFF = 'RESCHEDULE_CUTOFF';
export const CANCELLATION_CUTOFF = 'CANCELLATION_CUTOFF';
export const rescheduleCutoff = () => new AppError(409, RESCHEDULE_CUTOFF, 'The reschedule cutoff has passed.');
export const cancellationCutoff = () => new AppError(409, CANCELLATION_CUTOFF, 'The cancellation cutoff has passed for this appointment.');
