import { useLocalSearchParams } from 'expo-router';
import { SharingScreen } from '@/components/setup/BusinessSetup';
import { useSessionStore } from '@/src/state/session';
export default function ShareScreen() {
  const { businessId } = useLocalSearchParams<{ businessId: string }>();
  const identity = useSessionStore(s => s.identityId), version = useSessionStore(s => s.contextVersion);
  const id = typeof businessId === 'string' ? businessId : '';
  return <SharingScreen key={`${identity}:${version}:${id}`} businessId={id} />;
}
