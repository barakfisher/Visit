import { safeAuthReturnTo } from '@visit/contracts';
import { Redirect, useLocalSearchParams } from 'expo-router';
export default function AuthEntry() { const { token, returnTo } = useLocalSearchParams<{ token?: string; returnTo?: string }>(); return <Redirect href={token ? { pathname: '/auth/email', params: { token, ...(safeAuthReturnTo(returnTo) ? { returnTo: safeAuthReturnTo(returnTo) } : {}) } } : '/auth/login'} />; }
