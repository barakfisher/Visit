import { ActivityIndicator, View } from 'react-native';
import { AppText } from './AppText';
import { DirectionalChevron } from './DirectionalChevron.component';
import { Control } from './Control';
import { CloseIcon } from './NavigationIcons.component';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { tokens } from '@/src/design/tokens';
import type { SavedProviderItem } from '../src/types/SavedProvider.types';
import { businessListingLine } from '@/src/lib/BusinessListing';
export type { SavedProviderItem } from '../src/types/SavedProvider.types';
/** The whole card opens the business page, which a chevron by the name says; its visible text is its accessible name. Removal is a sibling over its corner, because a button inside a button is invalid on web. */
export function SavedProviderCard({ item, removing = false, onBook, onRemove }: { item: SavedProviderItem; removing?: boolean; onBook: () => void; onRemove: () => void }) {
  const { t } = useAppLocale();
  const name = item.provider.name, listing = item.available ? businessListingLine(item.provider.location, item.provider.category) : null;
  return <View testID={`saved-provider-${item.businessId}`} className="grow rounded-card border border-line bg-surface">
    <Control accessibilityRole="button" accessibilityState={{ disabled: !item.available || removing }} disabled={!item.available || removing} onPress={onBook} className="grow gap-1 rounded-card p-4 active:bg-brand-soft">
      <View className="flex-row items-start justify-between gap-2">
        <AppText className="shrink font-semibold text-ink">{name}</AppText>
        {item.available ? <View style={{ paddingTop: 3 }}><DirectionalChevron pointing="forward" color={tokens.color.muted} /></View> : null}
      </View>
      {/* The end padding keeps the address clear of the remove icon in the card's corner. */}
      {listing ? <AppText style={{ paddingEnd: 28 }} className="text-sm text-body">{listing}</AppText> : null}
      {/* In the flow, so a note that wraps grows the card instead of covering the name; the end padding clears the remove icon. */}
      {item.available ? null : <AppText style={{ marginTop: 'auto', paddingTop: 8, paddingEnd: 28 }} className="text-sm font-semibold text-muted">{t('home.notAccepting')}</AppText>}
    </Control>
    <Control accessibilityRole="button" accessibilityLabel={t('home.remove', { name })} accessibilityState={{ disabled: removing, busy: removing }} disabled={removing} onPress={onRemove} className="absolute bottom-0 end-0 items-center justify-center rounded-card active:bg-brand-soft">
      {removing ? <ActivityIndicator accessibilityLabel={t('home.remove', { name })} color={tokens.color.muted} /> : <CloseIcon color={tokens.color.muted} />}
    </Control>
  </View>;
}
