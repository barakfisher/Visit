import { View } from 'react-native';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { useAppLocale } from '@/src/i18n/LocaleContext';
export type SavedProviderItem = { id: string; businessId: string; available: boolean; provider: { id: string; name: string; location?: string | null; category?: string } };
export function SavedProviderCard({ item, removing = false, onBook, onRemove }: { item: SavedProviderItem; removing?: boolean; onBook: () => void; onRemove: () => void }) {
  const { t } = useAppLocale();
  return <View testID={`saved-provider-${item.businessId}`} className="gap-3 rounded-card border border-line bg-surface p-4">
    <AppText accessibilityRole="header" className="text-lg font-semibold text-ink">{item.provider.name}</AppText>
    {item.available ? item.provider.location || item.provider.category ? <AppText className="text-sm text-body">{[item.provider.location, item.provider.category].filter(Boolean).join(' · ')}</AppText> : null : <AppText className="text-sm text-muted">{t('home.providerUnavailable')}</AppText>}
    <View className="flex-row flex-wrap gap-3">
      <View style={{ flexGrow: 1, flexBasis: 150 }}><ActionButton label={t(item.available ? 'home.book' : 'home.notAccepting')} disabled={!item.available || removing} onPress={onBook} /></View>
      <ActionButton secondary label={t('home.remove')} busy={removing} onPress={onRemove} />
    </View>
  </View>;
}
