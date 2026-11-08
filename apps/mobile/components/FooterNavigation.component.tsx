import type { ComponentType } from 'react';
import { View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { AppText } from './AppText';
import { CalendarIcon } from './AppointmentActionIcons.component';
import { Control } from './Control';
import { HomeIcon, PlusIcon, TeamIcon } from './NavigationIcons.component';
import type { FooterIcon, FooterNavigationProps } from '@/src/types/FooterNavigation.types';

const icons: Record<FooterIcon, ComponentType<{ color: string }>> = { home: HomeIcon, appointments: CalendarIcon, add: PlusIcon, team: TeamIcon };

/** The current mode's main destinations, one tap away from every screen (decisions.md, 2026-11-08). */
export function FooterNavigation({ tabs }: FooterNavigationProps) {
  return <View testID="app-footer" className="border-t border-line bg-surface">
    <View className="mx-auto w-full max-w-3xl flex-row">
      {tabs.map(({ key, label, active, onPress }) => {
        const Icon = icons[key];
        return <Control key={key} accessibilityRole="button" accessibilityState={{ selected: active }} aria-current={active ? 'page' : undefined} onPress={onPress} className="flex-1 items-center justify-center gap-0.5 py-1 active:bg-brand-soft">
          <Icon color={active ? tokens.color.brand : tokens.color.muted} />
          <AppText style={{ textAlign: 'center' }} className={`text-xs font-semibold ${active ? 'text-brand' : 'text-muted'}`}>{label}</AppText>
        </Control>;
      })}
    </View>
  </View>;
}
