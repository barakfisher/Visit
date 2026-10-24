/** Keep query strings, credentials, provider bodies and Prisma input out of logs. */
export function safeRequestLog(request: { method?: string; url?: string }) {
  return { ...(request.method !== undefined ? { method: request.method } : {}), ...(request.url !== undefined ? { url: request.url.split('?', 1)[0]! } : {}) };
}
export function safeErrorLog(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  return { category: 'unexpected_error', ...(typeof code === 'string' && /^P\d{4}$/.test(code) ? { code } : {}) };
}
