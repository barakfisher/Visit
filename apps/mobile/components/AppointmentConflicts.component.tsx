import { View } from 'react-native';
import type { BlockConflict } from '@/src/types/TimeBlocks.types';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { AppText } from './AppText';

/** The appointments and reservations that stopped a change, capped by the server, with how many more there are. */
export function AppointmentConflicts({ title, total, conflicts, when, testID }: { title: string; total: number; conflicts: readonly BlockConflict[]; when: (instant: string) => string; testID?: string }) {
  const { t } = useAppLocale();
  return <View testID={testID} className="gap-2 rounded-control border border-danger bg-canvas p-3">
    <AppText accessibilityRole="alert" className="text-danger">{title}</AppText>
    {conflicts.map((row, index) => <AppText key={row.kind === 'APPOINTMENT' ? row.id : `reservation-${index}`} className="text-sm text-ink">
      {when(row.startsAt)} · {row.staffName} · {row.kind === 'APPOINTMENT' ? [row.customerName, row.serviceName].filter(Boolean).join(' · ') || t('dashboard.customer') : t('blocks.reservation')}
    </AppText>)}
    {total > conflicts.length ? <AppText className="text-sm text-body">{t('blocks.more', { count: total - conflicts.length })}</AppText> : null}
  </View>;
}
