import { Pressable, TextInput, View } from 'react-native';
import { AppText as Text } from './AppText';
import { ActionButton } from './ActionButton';
import type { ManualBookingView, ManualDraft } from '../src/types/ManualBooking.types';
import type { MessageKey } from '../src/i18n/messages';
const fieldClass = 'rounded-control border border-line bg-surface px-4 py-3 text-ink';
const fields: { key: keyof Pick<ManualDraft, 'customerName' | 'customerPhone' | 'customerEmail' | 'localDate' | 'localTime' | 'utcOffset'>; label: MessageKey; max: number }[] = [
 { key: 'customerName', label: 'manual.name', max: 120 }, { key: 'customerPhone', label: 'manual.phone', max: 16 }, { key: 'customerEmail', label: 'manual.email', max: 254 },
 { key: 'localDate', label: 'manual.date', max: 10 }, { key: 'localTime', label: 'manual.time', max: 5 }, { key: 'utcOffset', label: 'manual.offset', max: 6 },
];
export function ManualBooking(view: ManualBookingView) {
 const { t, draft, update, options, busy, locked } = view;
 const service = options?.services.find(row => row.id === draft.serviceId), staff = service?.staff.find(row => row.id === draft.staffId);
 if (!draft.open) return <ActionButton secondary label={t('manual.open')} onPress={() => update({ open: true })} />;
 return <View className="gap-3 rounded-card border border-line bg-surface p-5" testID="manual-booking-form">
  <Text accessibilityRole="header" className="text-xl font-semibold text-ink">{t('manual.title')}</Text><Text>{t('manual.intro')}</Text><Text className="text-sm text-muted">{view.timeNote}</Text><Text>{t('manual.unverified')}</Text>
  {view.success ? <Text accessibilityRole="status">{view.feedback}</Text> : !locked && !draft.reviewed && view.loadError ? <View className="gap-2"><Text accessibilityRole="alert">{t('manual.loadError')}</Text><ActionButton secondary label={t('common.retry')} onPress={view.retry} /></View> : !locked && !draft.reviewed && view.loading ? <Text>{t('manual.loading')}</Text> : !locked && !draft.reviewed && !options?.bookable ? <Text>{t('manual.notBookable')}</Text> : !locked && !draft.reviewed && !options?.services.some(row => row.staff.length) ? <Text>{t('manual.empty')}</Text> : <>
   {draft.reviewed || locked ? <View className="gap-2"><Text accessibilityRole="header" className="font-semibold">{t('manual.reviewTitle')}</Text><Text>{view.serviceSummary || service?.name || draft.serviceId} · {staff?.displayName ?? draft.staffId}</Text><Text>{draft.localDate} · {draft.localTime} {draft.utcOffset}</Text><Text>{draft.customerName}</Text><Text>{draft.customerPhone}</Text>{draft.customerEmail ? <Text>{draft.customerEmail}</Text> : null}{draft.exceptionReason ? <Text>{t('manual.exception')}: {draft.exceptionReason}</Text> : null}<ActionButton label={t(locked && !busy ? 'manual.retry' : 'manual.confirm')} onPress={view.confirm} busy={busy} /><ActionButton secondary label={t('manual.edit')} disabled={busy || locked} onPress={() => update({ reviewed: false })} /></View> : <>
    <Text className="font-semibold">{t('manual.service')}</Text><View className="flex-row flex-wrap gap-2">{options?.services.filter(row => row.staff.length).map(row => <Pressable key={row.id} accessibilityRole="button" accessibilityState={{ selected: row.id === draft.serviceId }} disabled={busy} onPress={() => update({ serviceId: row.id, staffId: '' })} className="rounded-control border border-line px-3 py-3"><Text>{row.name}{row.id === draft.serviceId ? ' ✓' : ''}</Text></Pressable>)}</View>
    <Text className="font-semibold">{t('manual.staff')}</Text><View className="flex-row flex-wrap gap-2">{service?.staff.map(row => <Pressable key={row.id} accessibilityRole="button" accessibilityState={{ selected: row.id === draft.staffId }} disabled={busy} onPress={() => update({ staffId: row.id })} className="rounded-control border border-line px-3 py-3"><Text>{row.displayName} · {t('agendaEdit.capacity', { count: row.parallelCapacity })}{row.id === draft.staffId ? ' ✓' : ''}</Text></Pressable>)}</View>
    {fields.map(field => <View key={field.key} className="gap-1"><Text>{t(field.label)}</Text><TextInput accessibilityLabel={t(field.label)} value={draft[field.key]} onChangeText={value => update({ [field.key]: value })} editable={!busy} maxLength={field.max} autoCapitalize={field.key === 'customerName' ? 'words' : 'none'} keyboardType={field.key === 'customerPhone' ? 'phone-pad' : field.key === 'customerEmail' ? 'email-address' : 'default'} className={fieldClass} /></View>)}<Text className="text-sm text-muted">{t('manual.offsetHelp')}</Text>
    {options?.requiresException ? <Text>{t('manual.exceptionHelp')}</Text> : null}<View className="gap-1"><Text>{t('manual.exception')}</Text><TextInput accessibilityLabel={t('manual.exception')} value={draft.exceptionReason} onChangeText={exceptionReason => update({ exceptionReason })} editable={!busy} maxLength={500} multiline className={fieldClass} /></View><ActionButton label={t('manual.review')} onPress={view.review} disabled={busy} />
   </>}
  </>}
  {view.feedback && !view.success ? <Text accessibilityRole="alert" className="text-danger">{view.feedback}</Text> : null}<ActionButton secondary label={t('manual.close')} onPress={view.close} disabled={busy || locked} />
 </View>;
}
