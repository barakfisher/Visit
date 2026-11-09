import { ScrollView, View } from 'react-native';
import { SavedProviderCard } from './SavedProviderCard';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { Control } from './Control';
import { SessionLoading } from './SessionLoading';
import { UpcomingAppointment } from './UpcomingAppointment.component';
import { BusinessSetupNotice } from './BusinessSetupNotice.component';
import { RemoveProviderDialog } from './RemoveProviderDialog.component';
import type { HomeView } from '../src/types/Home.types';
const pairs = <T,>(items: T[]) => items.flatMap((item, index) => index % 2 ? [] : [[item, items[index + 1]] as [T, T | undefined]]);
export function Home(view: HomeView) {
  const { t } = view;
  if (view.bootstrapping) return <SessionLoading />;
  const empty = view.providersState === 'ready' && !view.providers.length;
  return <ScrollView testID="home-screen" className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-5 px-5 py-6 md:px-8">
    {/* Someone with providers came for them; the welcome is for someone with an empty list. */}
    {empty ? <View className="gap-2"><AppText accessibilityRole="header" className="text-3xl font-bold tracking-tight text-ink">{t('home.title')}</AppText><AppText className="text-base leading-6 text-body">{t('home.intro')}</AppText></View> : null}
    {view.businesses.filter(item => !item.published).map(item => <BusinessSetupNotice key={item.id} t={t} item={item} opening={view.openingBusiness === item.id} disabled={!!view.openingBusiness} onManage={() => view.onManage(item.id)} />)}
    {view.businessError ? <AppText accessibilityRole="alert" className="text-danger">{t(view.businessError)}</AppText> : null}
    <UpcomingAppointment {...view.upcoming} />
    <AppText accessibilityRole="header" className="text-xl font-bold text-ink">{t('home.providers')}</AppText>
    {view.providersState === 'loading' ? <AppText>{t('home.loadingProviders')}</AppText> : view.providersState === 'error' ? <View className="gap-3 rounded-card border border-line bg-surface p-5"><AppText accessibilityRole="alert">{t('home.providersFailure')}</AppText><ActionButton secondary label={t('home.retryProviders')} onPress={view.onRetryProviders} /></View> : <>
      {empty ? <View className="gap-3 rounded-card border border-line bg-surface p-5"><AppText className="font-semibold text-ink">{t('home.empty')}</AppText><AppText className="leading-6 text-body">{t('home.emptyHelp')}</AppText></View> : <View className="gap-3">
        {/* Rows of two at every width; the spacer keeps a lone last card the same width as the others. */}
        {pairs(view.providers).map(([first, second]) => <View key={first.id} className="flex-row gap-3">
          {[first, second].map(item => <View key={item?.id ?? 'spacer'} className="flex-1">{item ? <SavedProviderCard item={item} removing={view.removingId === item.businessId} onBook={() => view.onBook(item.businessId)} onRemove={() => view.onRemove(item.businessId)} /> : null}</View>)}
        </View>)}
      </View>}
      {view.hasMore ? <ActionButton secondary label={t('home.more')} busy={view.loadingMore} onPress={view.onMore} /> : null}
    </>}
    {view.removeError ? <AppText accessibilityRole="alert" className="text-danger">{t('home.removeFailure')}</AppText> : null}
    {view.hasArchive ? <Control accessibilityRole="button" accessibilityLabel={t('home.archive')} onPress={view.onArchive} className="items-center justify-center"><AppText className="font-semibold text-brand">{t('home.archive')}</AppText></Control> : null}
    <RemoveProviderDialog t={t} name={view.removeName} busy={!!view.removingId} onConfirm={view.onConfirmRemove} onClose={view.onCancelRemove} />
  </ScrollView>;
}
