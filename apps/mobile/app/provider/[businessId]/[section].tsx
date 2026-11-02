import { Redirect, useLocalSearchParams } from 'expo-router';
import { SettingsSection } from '@/components/setup/BusinessSetup';
import { useSessionStore } from '@/src/state/session';
import { isSetupSection } from '@/src/lib/BusinessReadiness';
export default function SettingsSectionScreen() {
  const { businessId, section } = useLocalSearchParams<{ businessId: string; section: string }>();
  const identity = useSessionStore(s => s.identityId), version = useSessionStore(s => s.contextVersion);
  const id = typeof businessId === 'string' ? businessId : '';
  if (!isSetupSection(section)) return <Redirect href={{ pathname: '/provider/[businessId]', params: { businessId: id } }} />;
  return <SettingsSection key={`${identity}:${version}:${id}:${section}`} businessId={id} section={section} />;
}
