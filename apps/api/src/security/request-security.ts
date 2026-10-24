import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../http/errors.js';

export function assertRequestOrigin(request: Pick<FastifyRequest, 'method' | 'headers'>, trustedOrigin: string) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.origin;
  const denied = () => { throw new AppError(403, 'CSRF_REJECTED', 'This request origin is not allowed.'); };
  if (origin) {
    if (origin !== new URL(trustedOrigin).origin) denied();
    return;
  }
  // Cookie writes require the configured Origin. Native/API callers do not use
  // ambient browser credentials; custom headers/JSON cannot be sent by forms.
  if (/(?:^|;)\s*(?:__Host-)?visit_session=/.test(request.headers.cookie ?? '') || request.headers['sec-fetch-site']) denied();
  if (request.headers.authorization?.startsWith('Bearer ') || request.headers['x-visit-client'] === 'native' || request.headers['content-type']?.split(';', 1)[0]?.trim() === 'application/json') return;
  denied();
}

export function registerRequestSecurity(app: FastifyInstance, trustedOrigin: string) {
  app.addHook('onRequest', async request => assertRequestOrigin(request, trustedOrigin));
}
