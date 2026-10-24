import { Platform } from 'react-native';

const key = 'visit.session-token';
let webToken: string | null = null;

export async function readSessionToken() {
  if (Platform.OS === 'web') return webToken;
  const SecureStore = await import('expo-secure-store');
  return SecureStore.getItemAsync(key);
}

export async function saveSessionToken(token: string | null) {
  if (Platform.OS === 'web') {
    webToken = token;
    return;
  }
  const SecureStore = await import('expo-secure-store');
  if (token) await SecureStore.setItemAsync(key, token);
  else await SecureStore.deleteItemAsync(key);
}
