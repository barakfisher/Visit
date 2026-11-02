import { ActivityIndicator, View } from 'react-native';
import { formatPrice } from '@/src/i18n/messages';
import { useServiceCatalog, type ServiceCatalogState } from '@/src/lib/ServiceCatalog.hook';
import type { CatalogService } from '@/src/lib/ServiceDraft';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { AddButton } from './AddButton';
import { FormDialog } from './FormDialog';
import { ServiceForm } from './ServiceForm.component';

export function ServiceCatalog({ businessId }: { businessId: string }) {
  const state = useServiceCatalog(businessId);
  const { t, direction, services, busy, formOpen, editing, message, openAdd, cancelForm } = state;
  return <View className="gap-4" style={{ direction }}>
    <View className="flex-row flex-wrap items-center justify-between gap-3">
      <AppText accessibilityRole="header" className="text-xl font-semibold text-ink">{t('catalog.title')}</AppText>
      <AddButton testID="service-add" label={t('catalog.add')} disabled={busy || services.isLoading || services.isError} onPress={openAdd} />
    </View>
    {services.isLoading ? <ActivityIndicator accessibilityLabel={t('common.loading')} />
      : services.isError ? <><AppText accessibilityRole="alert">{t('catalog.loadFailed')}</AppText><ActionButton secondary label={t('common.retry')} onPress={() => void services.refetch()} /></>
      : !services.data?.services.length ? <AppText>{t('catalog.empty')}</AppText>
      : services.data.services.map(service => <ServiceCard key={service.id} service={service} {...state} />)}
    {message ? <AppText accessibilityRole="alert">{t(message)}</AppText> : null}
    <FormDialog title={t(editing ? 'catalog.edit' : 'catalog.add')} open={formOpen} onClose={cancelForm} testID="service-dialog"><ServiceForm {...state} /></FormDialog>
  </View>;
}
function ServiceCard({ service, t, locale, busy, deleting, deletingPending, openEdit, askDelete, confirmDelete }: ServiceCatalogState & { service: CatalogService }) {
  const price = service.priceMinor !== null && service.currency ? formatPrice(locale, service.priceMinor, service.currency) : t('catalog.unknownPrice');
  return <View testID={`service-card-${service.id}`} className="gap-3 rounded-control border border-line bg-surface p-4">
    <AppText className="text-lg font-semibold text-ink">{service.name}</AppText>
    {service.description ? <AppText>{service.description}</AppText> : null}
    <AppText>{t('catalog.minutes', { minutes: service.durationMinutes })} · {price}</AppText>
    {service.active ? null : <AppText className="self-start rounded-full bg-canvas px-3 py-1 text-sm font-semibold text-warning">{t('catalog.unavailable')}</AppText>}
    {deleting === service.id ? <View className="gap-3 rounded-control border border-line bg-canvas p-3">
      <AppText>{t('catalog.deleteHelp')}</AppText>
      <View className="flex-row gap-3">
        <View className="flex-1"><ActionButton busy={deletingPending === service.id} disabled={busy && deletingPending !== service.id} label={t('catalog.confirmDelete')} onPress={() => confirmDelete(service.id)} /></View>
        <View className="flex-1"><ActionButton secondary disabled={busy} label={t('catalog.back')} onPress={() => askDelete(null)} /></View>
      </View>
    </View> : <View className="flex-row flex-wrap gap-2">
      <ActionButton secondary disabled={busy} label={t('catalog.edit')} onPress={() => openEdit(service)} />
      <ActionButton secondary disabled={busy} label={t('catalog.delete')} onPress={() => askDelete(service.id)} />
    </View>}
  </View>;
}
