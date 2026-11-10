import { BookingFinalAction } from './BookingFinalAction.component';
import { BookingReview } from './BookingReview.component';
import { FormDialog } from './FormDialog';
import { ActivityIndicator, ScrollView, TextInput, View } from 'react-native';
// Aligned to the reading direction, so a Latin business name sits under a Hebrew title instead of across from it.
import { AppText as Text } from './AppText';
import { AccountMethods } from '@/components/auth/AccountMethods';
import { ActionButton } from '@/components/ActionButton';
import { CompactBookingControls } from './CompactBookingControls.component';
import { SmoothReveal } from './SmoothHeight.component';
import { bookingSlotId } from '@/src/lib/CompactBooking.utils';
import type { useBookingContactFlow } from '@/src/lib/BookingContactFlow.hook';
const slotId = bookingSlotId;
export function BookingContactFlow(props: ReturnType<typeof useBookingContactFlow>) {
  const { controls, review, reviewOpen, canReview, openReview, closeReview, confirmReviewed, movingFrom, reauthReturnTo, saveReauthDraft, t, fromBookingId, selected, busy, editingDisabled, pendingAttempt, pendingElsewhere, notice, error, detailsError, identityId, details, provider, chosenDate, slots, contacts, name, setName, choose, confirm, saveName } = props;
  return <View className="flex-1 bg-canvas"><ScrollView contentContainerClassName="mx-auto w-full max-w-3xl gap-6 px-5 py-6 pb-10 md:px-8">
    {/* The business name hangs under the title as its subtitle, close enough to read as one heading; a reschedule adds the appointment being moved on the same line. */}
    <View className="gap-0.5"><Text accessibilityRole="header" className="text-3xl font-bold text-ink">{t(fromBookingId ? 'compact.rescheduleTitle' : 'compact.title')}</Text>{provider ? <Text className="text-body">{movingFrom ? `${provider.name} · ${movingFrom}` : provider.name}</Text> : null}</View>
    {details.isLoading ? <ActivityIndicator accessibilityLabel={t('compact.loadingDetails')} color="#0f766e"/> : details.isError ? <View className="gap-2"><Text accessibilityRole="alert" className="text-danger">{detailsError}</Text><ActionButton secondary label={t('common.retry')} onPress={() => void details.refetch()} /></View> : <>
    <CompactBookingControls controls={controls} t={t} disabled={editingDisabled} date={chosenDate} selectedId={selected ? slotId(selected) : null} slotLoading={slots.isLoading} slotError={slots.isError && !slots.data} onRetrySlots={() => void slots.refetch()} onSelectSlot={id => { const slot = slots.data?.slots.find(item => slotId(item) === id); if (slot) void choose(slot); }} />
    {/* Shown only when the business needs a detail the customer has not given: the database refuses the booking without it (customer-contact-policy.md). */}
    {identityId && !fromBookingId ? contacts.isLoading ? <ActivityIndicator /> : contacts.isError ? <ActionButton secondary label={t('bookingContact.retry')} onPress={() => void contacts.refetch()} /> : contacts.data?.ready ? null : contacts.data ? <View className="gap-3"><Text accessibilityRole="header" className="text-xl font-bold text-ink">{t('bookingContact.title')}</Text>
      <Text>{t('bookingContact.help')}</Text>{contacts.data.missing.includes('name') ? <View className="gap-2"><TextInput accessibilityLabel={t('bookingContact.name')} value={name} onChangeText={setName} editable={!editingDisabled} maxLength={120} className="rounded-control border border-line p-4" /><ActionButton label={t('bookingContact.save')} disabled={name.trim().length < 2} busy={busy} onPress={() => void saveName()} /></View> : null}{contacts.data.missing.some(field => field === 'phone' || field === 'email') ? <AccountMethods key={identityId} contactOnly returnTo={reauthReturnTo} onReauthenticate={saveReauthDraft} /> : null}
    </View> : null : null}
    </>}

  </ScrollView>
  {/* Final consent: the exact time and terms are read here, and only this sheet's button books. */}
  <FormDialog testID="booking-review-sheet" title={t('bookingCommit.review')} open={reviewOpen && Boolean(review)} onClose={closeReview}>
    {review ? <BookingReview {...review} replaces={movingFrom ? t('compact.replaces', { when: movingFrom }) : ''} advisory={t('bookingCommit.advisory')} /> : null}
    <View className="gap-3 pt-2"><BookingFinalAction label={t(fromBookingId ? 'compact.reschedule' : 'compact.confirm')} onConfirm={confirmReviewed} busy={false} disabled={false} /><ActionButton secondary label={t('compact.backToEdit')} onPress={closeReview} /></View>
  </FormDialog>{/* The marker sits on the visible bar: a screen left in the stack keeps its own copy on web. */}<View testID={identityId && !fromBookingId && contacts.data?.ready ? 'booking-contact-ready' : 'booking-commit-bar'} className="border-t border-line bg-surface px-5 py-4"><View className="mx-auto w-full max-w-3xl"><SmoothReveal>{notice || error ? <View className="gap-3 pb-3">{notice ? <Text accessibilityLiveRegion="polite" className="rounded-control bg-brand-soft p-4 text-brand">{notice}</Text> : null}{error ? <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" className="rounded-control bg-red-50 p-4 text-danger">{error}</Text> : null}</View> : null}</SmoothReveal>{/* Signing in, resuming and retrying an attempt already consented to act at once; a new choice continues to the sheet. */}{!identityId || pendingElsewhere || pendingAttempt ? <BookingFinalAction label={!identityId ? t('compact.signIn') : pendingElsewhere ? t('bookingCommit.resumeOther') : busy ? t('bookingCommit.processing') : t('bookingCommit.retry')} onConfirm={confirm} busy={busy} disabled={!identityId && !selected} /> : <ActionButton testID="booking-continue" label={t('compact.continue')} busy={busy} disabled={!canReview} onPress={openReview} />}</View></View></View>;
}
