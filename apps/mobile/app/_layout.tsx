import '../global.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DefaultTheme, LocaleProvider, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import 'react-native-reanimated';

import { SafeAreaView } from 'react-native-safe-area-context';
import { queryClient } from '@/src/lib/queryClient';
import { apiRequest, ApiError } from '@/src/lib/api';
import type { AuthProfile } from '@/src/types/flows';
import { readSessionToken, saveSessionToken } from '@/src/lib/sessionToken';
import { useSessionStore } from '@/src/state/session';
import { AppLocaleProvider, useAppLocale } from '@/src/i18n/LocaleProvider';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  anchor: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <AppLocaleProvider><RootLayoutNav /></AppLocaleProvider>;
}

function RootLayoutNav() {
  const { direction, ready } = useAppLocale();
  const pathname = usePathname();
  const setAuth = useSessionStore((state) => state.setAuth);

  useEffect(() => {
    if (pathname.startsWith('/auth')) return;
    let active = true;
    apiRequest<{ profile: AuthProfile }>('/api/auth/me').then(async ({ profile }) => {
      const token = await readSessionToken();
      if (active) setAuth(token, profile);
    }).catch((error) => {
      if (active && error instanceof ApiError && error.status === 401) { useSessionStore.getState().clear(); void saveSessionToken(null); }
    });
    return () => { active = false; };
  }, [pathname, setAuth]);

  if (!ready) return null;
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={DefaultTheme}>
        <LocaleProvider direction={direction}><View {...(Platform.OS === 'web' ? { dir: direction } : {})} style={{ flex: 1, direction }}><SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc', direction }} edges={['top', 'bottom']}><Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="admin" options={{ headerShown: false }} />
          <Stack.Screen name="p" options={{ headerShown: false }} />
          <Stack.Screen name="register" options={{ headerShown: false }} />
          <Stack.Screen name="auth" options={{ headerShown: false }} />
          <Stack.Screen name="booking" options={{ headerShown: false }} />
          <Stack.Screen name="provider" options={{ headerShown: false }} />
          <Stack.Screen name="appointments" options={{ headerShown: false }} />
          <Stack.Screen name="discover" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        </Stack></SafeAreaView></View></LocaleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
