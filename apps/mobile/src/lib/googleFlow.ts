import { useEffect, useSyncExternalStore } from 'react';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { clearInitialURL } from 'expo-linking';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { apiRequest } from './api';
import { googleNativeLaunchUrl, parseGoogleCallback, safeGoogleReturnTo, type GoogleReceipt, type GoogleStart } from './googleCallback';

let receipt: GoogleReceipt | null = null, pending = false;
const listeners = new Set<() => void>();
const publish = (value: GoogleReceipt | null) => { receipt = value; listeners.forEach(listener => listener()); };
function expectedReturnUrl() { return process.env.EXPO_PUBLIC_GOOGLE_NATIVE_RETURN_URL || (__DEV__ ? 'visit://auth/google' : undefined); }
export function googleNativeAvailable() {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return false;
  const destination = expectedReturnUrl();
  if (!destination) return false;
  if (__DEV__ && destination === 'visit://auth/google') return true;
  try {
    const url = new URL(destination);
    if (url.protocol !== 'https:' || url.pathname !== '/auth/google' || url.search || url.hash || url.username || url.password) return false;
    // SDK 58's claimed HTTPS callback API requires iOS 17.4+ and associated domains.
    return Platform.OS !== 'ios' || Number.parseFloat(String(Platform.Version)) >= 17.4;
  } catch { return false; }
}
export async function beginGoogleSignIn({ intent = 'login', returnTo }: GoogleStart = {}) {
  if (pending || !googleNativeAvailable()) throw new Error('Google native authentication unavailable');
  pending = true; publish(null);
  try {
    // Async random bytes use native secure entropy, including development builds.
    const entropy = await Crypto.getRandomBytesAsync(64);
    const encode = (bytes: Uint8Array) => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    const verifier = encode(entropy.slice(0, 32));
    // Independently random state hashed to 32 bytes and encoded into 43 base64url characters.
    const clientState = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, encode(entropy.slice(32)), { encoding: Crypto.CryptoEncoding.BASE64 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const challenge = (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const startedAt = Date.now();
    const start = await apiRequest<{ authorizationUrl: string; nativeReturnUrl: string }>('/api/auth/google/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ platform: 'native', intent, challenge, clientState, ...(intent === 'link' ? { consent: true } : {}) }) });
    if (start.nativeReturnUrl !== expectedReturnUrl()) throw new Error('Native return URL does not match this build');
    const launch = googleNativeLaunchUrl(start.authorizationUrl, process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000');
    // Expo owns the Linking listener. Do not add a competing listener or expose verifier in Router state.
    const result = await WebBrowser.openAuthSessionAsync(launch, start.nativeReturnUrl, { preferUniversalLinks: start.nativeReturnUrl.startsWith('https:') });
    if (result.type === 'success' && Date.now() - startedAt < 600_000) {
      const parsed = parseGoogleCallback(result.url, start.nativeReturnUrl, clientState);
      publish('grant' in parsed ? { ...parsed, verifier, returnTo: safeGoogleReturnTo(returnTo) } : { ...parsed, returnTo: safeGoogleReturnTo(returnTo) });
    } else publish({ status: result.type === 'cancel' || result.type === 'dismiss' ? 'cancelled' : 'invalid', returnTo: safeGoogleReturnTo(returnTo) });
    router.replace('/auth/google');
  } catch (error) { publish({ status: 'failed', returnTo: safeGoogleReturnTo(returnTo) }); throw error; }
  finally { pending = false; }
}
export function useGoogleReceipt() {
  const hasParams = Object.keys(useLocalSearchParams()).length > 0;
  const value = useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => receipt, () => null);
  useEffect(() => {
    clearInitialURL();
    if (hasParams) router.replace('/auth/google');
    if (!pending && !receipt) publish({ status: 'invalid' }); // Process death never reconstructs a verifier from a URL.
  }, [hasParams]);
  return { receipt: value, clear: () => publish({ status: 'invalid' }) };
}
