import { ScrollView, View } from 'react-native';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { Control } from './Control';
import { SessionLoading } from './SessionLoading';
import type { NotificationsView } from '../src/types/Notifications.types';

export function Notifications(view: NotificationsView) {
  const { t } = view;
  if (view.bootstrapping) return <SessionLoading />;
  return <ScrollView testID="notifications-screen" className="flex-1 bg-canvas" contentContainerClassName="mx-auto w-full max-w-2xl gap-4 px-5 py-6 md:px-8">
    <AppText accessibilityRole="header" className="text-2xl font-bold tracking-tight text-ink">{t('notifications.title')}</AppText>
    {view.openError ? <AppText accessibilityRole="alert" className="text-danger">{t(view.openError)}</AppText> : null}
    {view.state === 'loading' ? <AppText role="status">{t('notifications.loading')}</AppText>
      : view.state === 'error' ? <View className="gap-3 rounded-card border border-line bg-surface p-5"><AppText accessibilityRole="alert">{t('notifications.failure')}</AppText><ActionButton secondary label={t('common.retry')} onPress={view.onRetry} /></View>
      : !view.rows.length ? <View className="gap-2 rounded-card border border-line bg-surface p-5"><AppText className="font-semibold text-ink">{t('notifications.empty')}</AppText><AppText className="leading-6 text-body">{t('notifications.emptyHelp')}</AppText></View>
      : view.rows.map(row => <Control key={row.id} testID={`notification-${row.id}`} accessibilityRole="button" disabled={!!view.openingId} onPress={() => view.onOpen(row)} className={`gap-1 rounded-card border p-4 active:opacity-70 ${row.isNew ? 'border-brand bg-brand-soft' : 'border-line bg-surface'}`}>
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <AppText className="font-semibold text-ink" style={{ flexShrink: 1 }}>{row.title}</AppText>
          {row.isNew ? <AppText className="text-xs font-semibold text-brand">{t('notifications.new')}</AppText> : null}
        </View>
        <AppText className="text-sm font-semibold text-body">{row.businessName}</AppText>
        {row.lines.map((line, index) => <AppText key={index} className="text-sm text-body">{line}</AppText>)}
        {row.action ? <AppText className="mt-1 text-sm font-semibold text-brand">{row.action}</AppText> : null}
        <AppText className="text-xs text-body">{row.received}</AppText>
      </Control>)}
  </ScrollView>;
}
