import { Redirect, useLocalSearchParams } from 'expo-router';
import { SettingsHub } from '@/components/setup/BusinessSetup';
import { useSessionStore } from '@/src/state/session';
import { isSetupSection } from '@/src/lib/BusinessReadiness';
export default function SettingsScreen() {
  const { businessId, section } = useLocalSearchParams<{ businessId: string; section?: string }>();
  const identity = useSessionStore(s => s.identityId), version = useSessionStore(s => s.contextVersion);
  const id = typeof businessId === 'string' ? businessId : '';
  // Earlier links opened a section with ?section=; each section is its own screen now.
  if (isSetupSection(section)) return <Redirect href={{ pathname: '/provider/[businessId]/[section]', params: { businessId: id, section } }} />;
  return <SettingsHub key={`${identity}:${version}:${id}`} businessId={id} />;
}
