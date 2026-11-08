import { fetch as expoFetch } from 'expo/fetch';

/** React Native's global fetch buffers the whole body, so a stream that stays open never delivers anything. */
export const streamingFetch = expoFetch as unknown as typeof fetch;
