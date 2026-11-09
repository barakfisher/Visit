import { ScrollView, View } from 'react-native';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { SessionLoading } from './SessionLoading';
import type { ArchivedProvidersView } from '../src/types/ArchivedProviders.types';
export function ArchivedProviders(view: ArchivedProvidersView) {
  const { t } = view;
  if (view.bootstrapping) return <SessionLoading />;
  return <ScrollView testID="archived-providers" className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-5 px-5 py-6 md:px-8">
    <View className="gap-2"><AppText accessibilityRole="header" className="text-3xl font-bold tracking-tight text-ink">{t('archive.title')}</AppText><AppText className="leading-6 text-body">{t('archive.intro')}</AppText></View>
    {view.state === 'loading' ? <AppText role="status">{t('archive.loading')}</AppText> : view.state === 'error' ? <View className="gap-3 rounded-card border border-line bg-surface p-5"><AppText accessibilityRole="alert">{t('archive.failure')}</AppText><ActionButton secondary label={t('archive.retry')} onPress={view.onRetry} /></View> : !view.providers.length ? <View className="rounded-card border border-line bg-surface p-5"><AppText className="font-semibold text-ink">{t('archive.empty')}</AppText></View> : <>
      {view.providers.map(item => <View key={item.id} testID={`archived-provider-${item.businessId}`} className="flex-row flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-4">
        <View className="gap-1" style={{ flexGrow: 1, flexShrink: 1, flexBasis: 150 }}>
          <AppText className="font-semibold text-ink">{item.provider.name}</AppText>
          {item.available ? null : <AppText className="text-sm text-muted">{t('home.notAccepting')}</AppText>}
        </View>
        <ActionButton secondary label={t('archive.restore')} busy={view.restoringId === item.businessId} disabled={!!view.restoringId} onPress={() => view.onRestore(item.businessId)} />
      </View>)}
      {view.hasMore ? <ActionButton secondary label={t('home.more')} busy={view.loadingMore} onPress={view.onMore} /> : null}
    </>}
    {view.restoreError ? <AppText accessibilityRole="alert" className="text-danger">{t('archive.restoreFailure')}</AppText> : null}
    <ActionButton secondary label={t('archive.back')} onPress={view.onBack} />
  </ScrollView>;
}
