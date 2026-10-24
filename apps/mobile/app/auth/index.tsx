import { Redirect, useLocalSearchParams } from 'expo-router';
export default function AuthEntry() { const { token } = useLocalSearchParams<{ token?: string }>(); return <Redirect href={token ? { pathname: '/auth/email', params: { token } } : '/auth/login'} />; }
