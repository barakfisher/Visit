import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { AppText } from '@/components/AppText';
import { ActionButton } from '@/components/ActionButton';
import { ProviderAgenda } from '@/components/ProviderAgenda.component';
import { SessionLoading } from '@/components/SessionLoading';
import { useProviderWorkspace } from '@/components/ProviderAccess';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { needsSetupGuide } from '@/src/lib/BusinessReadiness';
import { useBusinessReadiness } from '@/src/lib/BusinessReadiness.hook';
import { useProviderAgenda } from '@/src/lib/ProviderAgenda.hook';
export default function ProviderDashboard() {
  const business = useProviderWorkspace(), { t } = useAppLocale();
  const readiness = useBusinessReadiness(business.id);
  if (readiness.isPending) return <SessionLoading />;
  if (readiness.isError) return <View className="flex-1 gap-4 bg-canvas p-6"><AppText accessibilityRole="alert">{t('setup.failure')}</AppText><ActionButton label={t('common.retry')} onPress={() => void readiness.refetch()} /></View>;
  // Until the business can publish, its settings are the only useful screen (decisions.md, 2026-11-01).
  if (needsSetupGuide(readiness.data)) return <Redirect href={{ pathname: '/provider/[businessId]', params: { businessId: business.id } }} />;
  return <Agenda published={!!readiness.data.publishedAt} />;
}
function Agenda({ published }: { published: boolean }) { return <ProviderAgenda {...useProviderAgenda()} published={published} />; }
