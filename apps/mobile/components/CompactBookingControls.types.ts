import type { useCompactBooking } from '@/src/lib/CompactBooking.hook';
import type { useAppLocale } from '@/src/i18n/LocaleContext';
export type CompactBookingControlsProps = { controls: ReturnType<typeof useCompactBooking>; t: ReturnType<typeof useAppLocale>['t']; disabled: boolean; date: string; selectedId: string | null; slotLoading: boolean; slotError: boolean; onRetrySlots: () => void; onSelectSlot: (id: string) => void };
