import { ScrollView, View } from 'react-native';
import { SavedProviderCard } from './SavedProviderCard';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { SessionLoading } from './SessionLoading';
import { UpcomingAppointment } from './UpcomingAppointment.component';
import type { HomeView } from '../src/types/Home.types';
export function Home(view: HomeView) {
  const { t, identity } = view;
  if (view.bootstrapping) return <SessionLoading />;
  return <ScrollView testID="home-screen" className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-5 px-5 py-6 md:px-8">
    <View className="gap-2"><AppText accessibilityRole="header" className="text-3xl font-bold tracking-tight text-ink">{t('home.title')}</AppText><AppText className="text-base leading-6 text-body">{t('home.intro')}</AppText></View>
    {!identity ? <ActionButton label={t('common.signIn')} onPress={view.onSignIn} /> : <>
      <UpcomingAppointment {...view.upcoming} />
      <ActionButton secondary label={t('appointments.all')} onPress={view.onAppointments} />
      <AppText accessibilityRole="header" className="text-xl font-bold text-ink">{t('home.providers')}</AppText>
      {view.providersState === 'loading' ? <AppText>{t('home.loadingProviders')}</AppText> : view.providersState === 'error' ? <View className="gap-3 rounded-card border border-line bg-surface p-5"><AppText accessibilityRole="alert">{t('home.providersFailure')}</AppText><ActionButton secondary label={t('home.retryProviders')} onPress={view.onRetryProviders} /></View> : <>
        {!view.providers.length ? <View className="gap-3 rounded-card border border-line bg-surface p-5"><AppText className="font-semibold text-ink">{t('home.empty')}</AppText><AppText className="leading-6 text-body">{t('home.emptyHelp')}</AppText></View> : view.providers.map(item => <SavedProviderCard key={item.id} item={item} removing={view.removingId === item.businessId} onBook={() => view.onBook(item.businessId)} onRemove={() => view.onRemove(item.businessId)} />)}
        {view.hasMore ? <ActionButton secondary label={t('home.more')} busy={view.loadingMore} onPress={view.onMore} /> : null}
      </>}
      {view.removeError ? <AppText accessibilityRole="alert" className="text-danger">{t('home.removeFailure')}</AppText> : null}
    </>}
  </ScrollView>;
}
