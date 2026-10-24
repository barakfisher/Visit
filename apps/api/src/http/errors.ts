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
