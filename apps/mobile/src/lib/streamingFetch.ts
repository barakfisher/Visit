/** Browsers stream response bodies with their own fetch. */
export const streamingFetch: typeof fetch = (...args) => globalThis.fetch(...args);
