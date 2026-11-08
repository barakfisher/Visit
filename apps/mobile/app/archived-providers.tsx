import { Redirect } from 'expo-router';
import { ArchivedProviders } from '@/components/ArchivedProviders.component';
import { useArchivedProviders } from '@/src/lib/ArchivedProviders.hook';
export default function ArchivedProvidersRoute() {
  const view = useArchivedProviders();
  return view.signedOut ? <Redirect href="/" /> : <ArchivedProviders {...view} />;
}
