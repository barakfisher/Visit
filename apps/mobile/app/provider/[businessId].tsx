import { useLocalSearchParams } from 'expo-router';
import { BusinessSetup } from '@/components/setup/BusinessSetup';
import { useSessionStore } from '@/src/state/session';
export default function SetupScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const identity = useSessionStore(s => s.identityId), version = useSessionStore(s => s.contextVersion);
  return <BusinessSetup key={`${identity}:${version}:${businessId}`} businessId={typeof businessId === 'string' ? businessId : ''} />;
}
