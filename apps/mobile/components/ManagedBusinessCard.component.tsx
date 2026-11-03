import { View } from 'react-native';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import type { HomeView, ManagedBusinessItem } from '../src/types/Home.types';
/** Customer Home's way into provider mode: says whether the approved business still needs setup or is open (decisions.md, 2026-11-03). */
export function ManagedBusinessCard({ t, item, opening, disabled, onManage }: { t: HomeView['t']; item: ManagedBusinessItem; opening: boolean; disabled: boolean; onManage: () => void }) {
  return <View testID={`managed-business-${item.id}`} className="gap-3 rounded-card border border-brand bg-brand-soft p-card">
    <AppText className="text-xs font-semibold uppercase tracking-widest text-brand">{t('home.business.title')}</AppText>
    <AppText accessibilityRole="header" className="text-lg font-semibold text-ink">{item.name}</AppText>
    <AppText className="leading-6 text-body">{t(item.published ? 'home.business.published' : 'home.business.approved')}</AppText>
    <ActionButton label={t(item.published ? 'home.business.manage' : 'home.business.setup')} busy={opening} disabled={disabled} onPress={onManage} />
  </View>;
}
