import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { AppText as Text } from './AppText';
import { ActionButton } from './ActionButton';
import { Control } from './Control';
import { DirectionalChevron } from './DirectionalChevron.component';
import { SmoothReveal } from './SmoothHeight.component';
import type { AgendaAppointment, ProviderAgendaView } from '@/src/types/ProviderAgenda.types';

type Props = Pick<ProviderAgendaView, 't' | 'contact'> & {
  booking: AgendaAppointment; span: string;
  /** The status, outcome buttons and change history, built by the agenda because Storybook cannot bundle their data hook. */
  lifecycle: ReactNode;
};

/**
 * One appointment on the business home, folded to its time, customer and service so a day fits on a screen.
 * A tap anywhere on it opens the rest in place: who serves it, how to reach the customer, and what can be done with it.
 */
export function AgendaAppointmentCard({ booking, span, lifecycle, t, contact }: Props) {
  const [open, setOpen] = useState(false);
  const customer = booking.customer.displayName ?? booking.customer.phone ?? booking.customer.email ?? t('dashboard.customer');
  const phone = booking.customer.phone;
  return <View testID={`agenda-booking-${booking.id}`} className="overflow-hidden rounded-card border border-line bg-surface">
    <Control testID={`agenda-booking-${booking.id}-toggle`} accessibilityRole="button" aria-expanded={open} accessibilityState={{ expanded: open }}
      onPress={() => setOpen(value => !value)}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-brand-soft">
      <View className="flex-1 gap-0.5">
        <View className="flex-row flex-wrap items-baseline gap-x-3">
          <Text className="font-bold text-brand">{span}</Text>
          <Text numberOfLines={1} className="shrink font-semibold text-ink">{customer}</Text>
        </View>
        <Text numberOfLines={1} className="text-sm text-body">{booking.service.name}</Text>
      </View>
      <DirectionalChevron pointing={open ? 'up' : 'down'} color={tokens.color.muted} />
    </Control>
    <SmoothReveal>{open ? <View testID={`agenda-booking-${booking.id}-details`} className="gap-3 border-t border-line px-4 pb-4 pt-3">
      <Text className="text-sm text-body">{booking.staff.displayName}{phone || booking.customer.email ? ` · ${phone ?? booking.customer.email}` : ''}</Text>
      {booking.source === 'MANUAL' ? <Text className="text-sm text-muted">{t('manual.tag')}{booking.manualReason ? ` · ${booking.manualReason}` : ''}</Text> : null}
      <View className="flex-row gap-2">
        <View className="flex-1"><ActionButton secondary label={t(phone ? 'dashboard.call' : 'dashboard.noPhoneCall')} disabled={!phone} onPress={() => contact(phone, 'call')} /></View>
        <View className="flex-1"><ActionButton secondary label={t(phone ? 'dashboard.whatsapp' : 'dashboard.noPhoneWhatsapp')} disabled={!phone} onPress={() => contact(phone, 'whatsapp')} /></View>
      </View>
      {lifecycle}
    </View> : null}</SmoothReveal>
  </View>;
}
