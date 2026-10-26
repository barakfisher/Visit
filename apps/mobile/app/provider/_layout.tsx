import { ProviderAccess } from '@/components/ProviderAccess';
import { Stack } from 'expo-router';
export default function Layout() { return <Stack screenOptions={{ headerShown: false }} screenLayout={({ children }) => <ProviderAccess>{children}</ProviderAccess>} />; }
