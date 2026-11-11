import { ActivityIndicator, View } from 'react-native';
import { AppText } from './AppText';
import { DirectionalChevron } from './DirectionalChevron.component';
import { Control } from './Control';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { tokens } from '@/src/design/tokens';
import type { SavedProviderItem } from '../src/types/SavedProvider.types';
import { businessListingLine } from '@/src/lib/BusinessListing';
export type { SavedProviderItem } from '../src/types/SavedProvider.types';
/** Every card is three lines tall: the name on one line, the address or note on up to two (decisions.md, 2026-11-11). */
const NAME_LINES = 1, DETAIL_LINES = 2;
const CARD_PADDING = 12, LINE_GAP = 4, DETAIL_LINE_HEIGHT = 20;
const CARD_MIN_HEIGHT = CARD_PADDING * 2 + tokens.typography.bodyLineHeight * NAME_LINES + LINE_GAP + DETAIL_LINE_HEIGHT * DETAIL_LINES;
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
/** The whole card opens the business page, which a chevron by the name says; its visible text is its accessible name. Removal is a sibling over its corner, because a button inside a button is invalid on web. */
export function SavedProviderCard({ item, removing = false, onBook, onRemove }: { item: SavedProviderItem; removing?: boolean; onBook: () => void; onRemove: () => void }) {
  const { t } = useAppLocale();
  const name = item.provider.name, listing = item.available ? businessListingLine(item.provider.location, item.provider.category) : null;
  return <View testID={`saved-provider-${item.businessId}`} className="grow rounded-card border border-line bg-surface">
    <Control accessibilityRole="button" accessibilityState={{ disabled: !item.available || removing }} disabled={!item.available || removing} onPress={onBook} style={{ minHeight: CARD_MIN_HEIGHT }} className="grow gap-1 rounded-card p-3 active:bg-brand-soft">
      <View className="flex-row items-start justify-between gap-2">
        <AppText numberOfLines={NAME_LINES} className="shrink text-base font-semibold text-ink">{name}</AppText>
        {item.available ? <View style={{ paddingTop: 3 }}><DirectionalChevron pointing="forward" color={tokens.color.muted} /></View> : null}
      </View>
      {/* The end padding keeps the address clear of the remove icon in the card's corner. */}
      {listing ? <AppText numberOfLines={DETAIL_LINES} style={{ paddingEnd: 28 }} className="text-sm text-body">{listing}</AppText> : null}
      {/* The end padding clears the remove icon in the corner. */}
      {item.available ? null : <AppText numberOfLines={DETAIL_LINES} style={{ paddingEnd: 28 }} className="text-sm font-semibold text-muted">{t('home.notAccepting')}</AppText>}
    </Control>
    <Control accessibilityRole="button" accessibilityLabel={t('home.remove', { name })} accessibilityState={{ disabled: removing, busy: removing }} disabled={removing} onPress={onRemove} className="absolute bottom-0 end-0 items-center justify-center rounded-card active:bg-brand-soft">
      {removing ? <ActivityIndicator accessibilityLabel={t('home.remove', { name })} color={tokens.color.muted} /> : <ArchiveIcon />}
    </Control>
  </View>;
}
