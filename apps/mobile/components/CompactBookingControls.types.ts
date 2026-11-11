import type { ReactNode } from 'react';
import type { useCompactBooking } from '@/src/lib/CompactBooking.hook';
import type { useAppLocale } from '@/src/i18n/LocaleContext';
export type CompactBookingControlsProps = { controls: ReturnType<typeof useCompactBooking>; t: ReturnType<typeof useAppLocale>['t']; disabled: boolean; date: string; selectedId: string | null; slotLoading: boolean; slotError: boolean; onRetrySlots: () => void; onSelectSlot: (id: string) => void; /** Shown between the date and the times, once a service is chosen. */ beforeTimes?: ReactNode;
  /** For a form that asks for both: a "*" on the service, and what is wrong under the service or the times. */ required?: boolean; serviceError?: string; timeError?: string };
