import { useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { AppText } from '../AppText';
import { TextField } from '../TextField';
import { ActionButton } from '../ActionButton';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { apiRequest } from '@/src/lib/api';
import { internationalPhone as toInternationalPhone } from '@/src/lib/PhoneNumber';
import { businessTimezoneLabel } from '@/src/lib/appointmentTime';
import { businessListingLine } from '@/src/lib/BusinessListing';
export type BusinessProfile = { id: string; name: string; slug: string; timezone: string; location: string | null; category: string | null; description: string | null; contactPhone: string | null; contactEmail: string | null; approvalStatus: string; publishedAt: string | null };
export function BusinessProfileForm({ business, onSaved }: { business: BusinessProfile; onSaved?: () => void }) {
  const { t, locale } = useAppLocale(), client = useQueryClient();
  const [name, setName] = useState(business.name), [location, setLocation] = useState(business.location ?? ''), [category, setCategory] = useState(business.category ?? '');
  const [description, setDescription] = useState(business.description ?? ''), [phone, setPhone] = useState(business.contactPhone ?? ''), [email, setEmail] = useState(business.contactEmail ?? '');
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState<'saved' | 'error' | ''>('');
  const internationalPhone = phone.trim() ? toInternationalPhone(phone) : null, validPhone = !phone.trim() || !!internationalPhone, validEmail = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  async function save() {
    if (busy) return; setBusy(true); setFeedback('');
    try { await apiRequest(`/v1/provider/businesses/${business.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), location: location.trim(), category: category.trim(), description: description.trim() || null, contactPhone: internationalPhone, contactEmail: email.trim() || null }) }); setFeedback('saved'); await client.invalidateQueries({ queryKey: ['provider', business.id] }); onSaved?.(); }
    catch { setFeedback('error'); } finally { setBusy(false); }
  }
  return <View className="gap-4"><AppText>{t('setup.publicHint')}</AppText>
    <TextField label={t('setup.name')} value={name} onChangeText={setName} maxLength={120} />
    <TextField label={t('setup.slug')} hint={t('setup.slugHint')} identifier value={business.slug} editable={false} />
    {/* The zone is fixed for the pilot, so it is shown as text, not as a field that looks editable. */}
    <View className="gap-2"><AppText className="font-medium text-ink">{t('setup.timezone')}</AppText><AppText testID="business-timezone" className="text-body">{businessTimezoneLabel(business.timezone, locale)}</AppText></View>
    <TextField label={t('setup.category')} value={category} onChangeText={setCategory} maxLength={80} />
    <TextField label={t('setup.location')} value={location} onChangeText={setLocation} maxLength={200} />
    <TextField label={t('setup.description')} value={description} onChangeText={setDescription} multiline maxLength={2000} />
    <TextField label={t('setup.phone')} hint={t('setup.phoneHint')} error={validPhone ? undefined : t('setup.invalidPhone')} identifier keyboardType="phone-pad" value={phone} onChangeText={setPhone} maxLength={16} />
    <TextField label={t('setup.email')} error={validEmail ? undefined : t('setup.invalidEmail')} identifier keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} maxLength={254} />
    <ActionButton label={t('setup.saveProfile')} busy={busy} disabled={name.trim().length < 2 || category.trim().length < 2 || location.trim().length < 2 || !validPhone || !validEmail} onPress={() => void save()} />
    {feedback ? <AppText role={feedback === 'error' ? 'alert' : 'status'}>{t(feedback === 'error' ? 'setup.saveFailure' : 'setup.saved')}</AppText> : null}
    <View className="gap-2 rounded-control border border-line p-4"><AppText accessibilityRole="header" className="font-semibold">{t('setup.preview')}</AppText><AppText>{t('setup.previewHint')}</AppText><AppText>{business.name}</AppText>{businessListingLine(business.location, business.category) ? <AppText>{businessListingLine(business.location, business.category)}</AppText> : null}{business.description ? <AppText>{business.description}</AppText> : null}{business.contactPhone ? <AppText style={{ writingDirection: 'ltr' }}>{business.contactPhone}</AppText> : null}{business.contactEmail ? <AppText style={{ writingDirection: 'ltr' }}>{business.contactEmail}</AppText> : null}</View>
  </View>;
}
