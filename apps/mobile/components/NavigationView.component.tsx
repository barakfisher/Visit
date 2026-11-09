import { navigationViewStyles as styles } from './NavigationView.styles';
import { View } from 'react-native';
import { tokens } from '@/src/design/tokens';
import { AppText } from './AppText';
import { Control } from './Control';
import { ModeSwitch } from './ModeSwitch.component';
import { AvatarIcon } from './NavigationIcons.component';
import type { NavigationViewProps } from '../src/types/NavigationView.types';
/** The signed-in header: the account on one side, the mode switch for people who manage a business on the other. */
export function NavigationView({ t, direction, providerMode, canSwitchMode, busy, error, onAccount, onSwitchMode }: NavigationViewProps) {
  return <View style={{ direction }} className="border-b border-line bg-surface">
    <View className="relative mx-auto w-full max-w-3xl flex-row items-center justify-between px-3 py-1">
      <Control accessibilityRole="button" accessibilityLabel={t('nav.account')} onPress={onAccount} className="items-center justify-center rounded-control active:bg-brand-soft"><AvatarIcon color={tokens.color.brand} /></Control>
      <View pointerEvents="none" style={styles.title}><AppText className="font-semibold tracking-widest text-brand">VISIT</AppText></View>
      {canSwitchMode ? <ModeSwitch label={t('nav.businessShort')} accessibilityLabel={t('nav.providerMode')} value={providerMode} disabled={busy} onChange={onSwitchMode} /> : null}
    </View>
    {providerMode ? <View testID="provider-mode-strip" className="bg-brand px-5 py-1"><AppText style={styles.centered} className="text-xs font-semibold text-white">{t('nav.providerMode')}</AppText></View> : null}
    {error ? <AppText accessibilityRole="alert" className="px-5 py-1 text-sm text-danger">{error}</AppText> : null}
  </View>;
}
