import { useState } from 'react';
import { View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { AppText } from '../AppText';
import { TextField } from '../TextField';
import { ActionButton } from '../ActionButton';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { apiRequest } from '@/src/lib/api';
export type BusinessProfile = { id: string; name: string; slug: string; timezone: string; location: string | null; category: string; description: string | null; contactPhone: string | null; contactEmail: string | null; approvalStatus: string; publishedAt: string | null };
export function BusinessProfileForm({ business }: { business: BusinessProfile }) {
  const { t } = useAppLocale(), client = useQueryClient();
  const [name, setName] = useState(business.name), [location, setLocation] = useState(business.location ?? ''), [category, setCategory] = useState(business.category);
  const [description, setDescription] = useState(business.description ?? ''), [phone, setPhone] = useState(business.contactPhone ?? ''), [email, setEmail] = useState(business.contactEmail ?? '');
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState<'saved' | 'error' | ''>('');
  const validPhone = !phone.trim() || /^\+[1-9]\d{7,14}$/.test(phone.trim()), validEmail = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  async function save() {
    if (busy) return; setBusy(true); setFeedback('');
    try { await apiRequest(`/v1/provider/businesses/${business.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), location: location.trim(), category: category.trim(), description: description.trim() || null, contactPhone: phone.trim() || null, contactEmail: email.trim() || null }) }); setFeedback('saved'); await client.invalidateQueries({ queryKey: ['provider', business.id] }); }
    catch { setFeedback('error'); } finally { setBusy(false); }
  }
  return <View className="gap-4"><AppText>{t('setup.publicHint')}</AppText>
    <TextField label={t('setup.name')} value={name} onChangeText={setName} maxLength={120} />
    <TextField label={t('setup.slug')} hint={t('setup.slugHint')} identifier value={business.slug} editable={false} />
    <TextField label={t('setup.timezone')} identifier value={business.timezone} editable={false} />
    <TextField label={t('setup.category')} value={category} onChangeText={setCategory} maxLength={80} />
    <TextField label={t('setup.location')} value={location} onChangeText={setLocation} maxLength={200} />
    <TextField label={t('setup.description')} value={description} onChangeText={setDescription} multiline maxLength={2000} />
    <TextField label={t('setup.phone')} error={validPhone ? undefined : t('setup.invalidPhone')} identifier keyboardType="phone-pad" value={phone} onChangeText={setPhone} maxLength={16} />
    <TextField label={t('setup.email')} error={validEmail ? undefined : t('setup.invalidEmail')} identifier keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} maxLength={254} />
    <ActionButton label={t('setup.saveProfile')} busy={busy} disabled={name.trim().length < 2 || category.trim().length < 2 || location.trim().length < 2 || !validPhone || !validEmail} onPress={() => void save()} />
    {feedback ? <AppText accessibilityRole={feedback === 'error' ? 'alert' : 'status'}>{t(feedback === 'error' ? 'setup.saveFailure' : 'setup.saved')}</AppText> : null}
    <View className="gap-2 rounded-control border border-line p-4"><AppText accessibilityRole="header" className="font-semibold">{t('setup.preview')}</AppText><AppText>{t('setup.previewHint')}</AppText><AppText>{business.name}</AppText><AppText>{business.location} · {business.category}</AppText>{business.description ? <AppText>{business.description}</AppText> : null}{business.contactPhone ? <AppText style={{ writingDirection: 'ltr' }}>{business.contactPhone}</AppText> : null}{business.contactEmail ? <AppText style={{ writingDirection: 'ltr' }}>{business.contactEmail}</AppText> : null}</View>
  </View>;
}
