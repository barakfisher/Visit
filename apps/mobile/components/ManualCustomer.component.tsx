import { View } from 'react-native';
import { AppText as Text } from './AppText';
import { ActionButton } from './ActionButton';
import { Control } from './Control';
import { TextField } from './TextField';
import { localPhone } from '../src/lib/PhoneNumber';
import { isolateLtr } from '../src/i18n/messages';
import type { CustomerCardSummary, ManualBookingView } from '../src/types/ManualBooking.types';

/** Names repeat, so a card is always shown with its phone, or its email when an app customer gave no phone. */
export function customerCardContact(card: CustomerCardSummary) { return card.phone ? localPhone(card.phone) : card.email ?? ''; }
const cardName = (t: ManualBookingView['t'], card: CustomerCardSummary) => card.name ?? t('manual.unnamed');

function Suggestion({ t, card, disabled, onPress }: { t: ManualBookingView['t']; card: CustomerCardSummary; disabled: boolean; onPress: () => void }) {
  const contact = customerCardContact(card), name = cardName(t, card);
  return <Control testID={`manual-customer-${card.id}`} accessibilityRole="button" disabled={disabled} onPress={onPress}
    className="min-h-touch flex-row flex-wrap items-center gap-x-2 rounded-control border border-line px-4 py-2">
    <Text className="font-semibold text-ink">{name}</Text>
    {contact ? <Text className="text-body">{isolateLtr(contact)}</Text> : null}
    {card.linked ? <Text className="text-sm text-brand">{t('manual.linked')}</Text> : null}
  </Control>;
}

/** What the search says under the name: searching, the suggestions, "New customer", or a failure that still lets the business type. */
function SearchResult({ view }: { view: ManualBookingView }) {
  const { t, customer, busy } = view;
  if (!customer.searched) return null;
  if (customer.searchError) return <View className="gap-2"><Text accessibilityRole="alert" className="text-sm text-body">{t('manual.searchError')}</Text><ActionButton secondary label={t('common.retry')} onPress={customer.onRetrySearch} disabled={busy} /></View>;
  if (customer.searching && !customer.suggestions.length) return <Text role="status" className="text-sm text-body">{t('manual.searching')}</Text>;
  if (!customer.suggestions.length) return <Text role="status" testID="manual-new-customer" className="text-sm text-body">{t('manual.newCustomer')}</Text>;
  return <View className="gap-2" testID="manual-suggestions">
    <Text className="text-sm font-semibold text-body">{t('manual.suggestions')}</Text>
    {customer.suggestions.map(card => <Suggestion key={card.id} t={t} card={card} disabled={busy} onPress={() => customer.onPick(card)} />)}
  </View>;
}

/**
 * The customer in the Add appointment sheet (customer-cards.md): pick one of this business's saved customers by name or
 * phone, or type a new one and save it. Typing by hand always works, whatever the search does.
 */
export function ManualCustomer({ view }: { view: ManualBookingView }) {
  const { t, draft, update, busy, customer } = view, card = draft.customerCard;
  if (card) {
    const contact = customerCardContact(card);
    return <View className="gap-3">
      <View testID="manual-picked-customer" className="gap-1 rounded-control border border-brand bg-brand-soft px-4 py-3">
        <Text className="text-sm text-body">{t('manual.pickedCustomer')}</Text>
        <Text className="font-semibold text-ink">{cardName(t, card)}</Text>
        {contact ? <Text className="text-ink">{isolateLtr(contact)}</Text> : null}
        {card.linked ? <Text className="text-sm text-brand">{t('manual.linked')}</Text> : null}
      </View>
      {/* An app customer's card may lack a name or phone; this booking still needs them, and they are not saved to the card. */}
      {card.name ? null : <TextField testID="manual-name" editable={!busy} label={t('manual.name')} value={draft.customerName} maxLength={120} autoCapitalize="words" onChangeText={customerName => update({ customerName })} />}
      {card.phone ? null : <TextField testID="manual-phone" identifier editable={!busy} label={t('manual.phone')} placeholder="050-1234567" value={draft.customerPhone} maxLength={20} keyboardType="phone-pad" autoComplete="tel" onChangeText={customerPhone => update({ customerPhone })} />}
      <ActionButton secondary testID="manual-change-customer" label={t('manual.changeCustomer')} onPress={customer.onClearPick} disabled={busy} />
    </View>;
  }
  const match = customer.phoneMatch;
  return <View className="gap-3">
    <TextField testID="manual-name" editable={!busy} label={t('manual.name')} value={draft.customerName} maxLength={120} autoCapitalize="words" autoComplete="off" onChangeText={customerName => update({ customerName })} />
    <SearchResult view={view} />
    <TextField testID="manual-phone" identifier editable={!busy} label={t('manual.phone')} placeholder="050-1234567" value={draft.customerPhone} maxLength={20} keyboardType="phone-pad" autoComplete="tel" onChangeText={customerPhone => update({ customerPhone })} />
    {match ? <View testID="manual-phone-match" className="gap-2">
      <Text role="status" className="text-ink">{t('manual.phoneMatch', { name: cardName(t, match) })}</Text>
      <ActionButton label={t('manual.useCustomer', { name: cardName(t, match) })} onPress={() => customer.onPick(match)} disabled={busy} />
    </View> : null}
    <TextField testID="manual-email" identifier editable={!busy} label={t('manual.email')} value={draft.customerEmail} maxLength={254} keyboardType="email-address" autoCapitalize="none" onChangeText={customerEmail => update({ customerEmail })} />
    <Control testID="manual-save-customer" accessibilityRole="checkbox" aria-checked={draft.saveCustomer} accessibilityLabel={t('manual.save')} accessibilityHint={t('manual.saveHint')} accessibilityState={{ checked: draft.saveCustomer, disabled: busy }} disabled={busy}
      onPress={() => update({ saveCustomer: !draft.saveCustomer })} className="min-h-touch flex-row items-center gap-3">
      <View className={`h-6 w-6 items-center justify-center rounded border-2 ${draft.saveCustomer ? 'border-brand bg-brand' : 'border-line'}`}>{draft.saveCustomer ? <Text className="font-bold text-surface">✓</Text> : null}</View>
      <View className="flex-1"><Text className="text-ink">{t('manual.save')}</Text><Text className="text-sm text-body">{t('manual.saveHint')}</Text></View>
    </Control>
  </View>;
}

/** One line on the review: which card the booking goes on, if any. */
export function customerReviewLine(t: ManualBookingView['t'], draft: ManualBookingView['draft']) {
  return t(draft.customerCard ? 'manual.reviewSaved' : draft.saveCustomer ? 'manual.reviewSave' : 'manual.reviewNotSaved');
}
