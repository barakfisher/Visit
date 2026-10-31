import { Redirect } from 'expo-router';
import { Home } from '@/components/Home.component';
import { useHome } from '@/src/lib/Home.hook';
// A signed-out visitor has nothing on Home; sign-in returns here.
export default function HomeScreen() { const view = useHome(); if (!view.bootstrapping && !view.identity) return <Redirect href="/auth/login" />; return <Home {...view} />; }
