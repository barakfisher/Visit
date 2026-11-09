import { View } from 'react-native';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import type { HomeView, ManagedBusinessItem } from '../src/types/Home.types';
/** Customer Home's reminder that an approved business still has settings to finish. Once it opens, the header's switch is the way in. */
export function BusinessSetupNotice({ t, item, opening, disabled, onManage }: { t: HomeView['t']; item: ManagedBusinessItem; opening: boolean; disabled: boolean; onManage: () => void }) {
  return <View testID={`business-setup-${item.id}`} className="flex-row flex-wrap items-center gap-3 rounded-card border border-brand bg-brand-soft p-4">
    <View className="gap-1" style={{ flexGrow: 1, flexShrink: 1, flexBasis: 180 }}>
      <AppText accessibilityRole="header" className="font-semibold text-ink">{item.name}</AppText>
      <AppText className="text-sm text-body">{t('home.business.approved')}</AppText>
    </View>
    <ActionButton label={t('home.business.setup')} busy={opening} disabled={disabled} onPress={onManage} />
  </View>;
}
