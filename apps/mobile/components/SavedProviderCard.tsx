import { ActivityIndicator, View } from 'react-native';
import { AppText } from './AppText';
import { Control } from './Control';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { tokens } from '@/src/design/tokens';
import type { SavedProviderItem } from '../src/types/SavedProvider.types';
import { businessListingLine } from '@/src/lib/BusinessListing';
export type { SavedProviderItem } from '../src/types/SavedProvider.types';
/** An archive box drawn from Views rather than an icon font or SVG: the app ships neither on web. */
function ArchiveIcon() {
  const color = tokens.color.muted;
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: 20, height: 18, alignItems: 'center' }}>
    <View style={{ width: 20, height: 6, borderWidth: 2, borderColor: color, borderRadius: 2 }} />
    <View style={{ width: 16, height: 12, marginTop: -1, borderWidth: 2, borderColor: color, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, alignItems: 'center', paddingTop: 2 }}>
      <View style={{ width: 6, height: 2, backgroundColor: color }} />
    </View>
  </View>;
}
/** The whole card opens booking; its visible text is its accessible name. Removal is a sibling over its corner, because a button inside a button is invalid on web. */
export function SavedProviderCard({ item, removing = false, onBook, onRemove }: { item: SavedProviderItem; removing?: boolean; onBook: () => void; onRemove: () => void }) {
  const { t } = useAppLocale();
  const name = item.provider.name, listing = item.available ? businessListingLine(item.provider.location, item.provider.category) : null;
  return <View testID={`saved-provider-${item.businessId}`} className="grow rounded-card border border-line bg-surface">
    <Control accessibilityRole="button" accessibilityState={{ disabled: !item.available || removing }} disabled={!item.available || removing} onPress={onBook} className="grow gap-1 rounded-card p-3 active:bg-brand-soft">
      <AppText className="font-semibold text-ink">{name}</AppText>
      {listing ? <AppText className="text-sm text-body">{listing}</AppText> : null}
      {/* In the flow, so a label that wraps grows the card instead of covering the name; the end padding clears the remove icon. */}
      <AppText style={{ marginTop: 'auto', paddingTop: 8, paddingEnd: 28 }} className={`text-sm font-semibold ${item.available ? 'text-brand' : 'text-muted'}`}>{t(item.available ? 'home.book' : 'home.notAccepting')}</AppText>
    </Control>
    <Control accessibilityRole="button" accessibilityLabel={t('home.remove', { name })} accessibilityState={{ disabled: removing, busy: removing }} disabled={removing} onPress={onRemove} className="absolute bottom-0 end-0 items-center justify-center rounded-card active:bg-brand-soft">
      {removing ? <ActivityIndicator accessibilityLabel={t('home.remove', { name })} color={tokens.color.muted} /> : <ArchiveIcon />}
    </Control>
  </View>;
}
