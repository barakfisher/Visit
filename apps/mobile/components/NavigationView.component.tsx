import { navigationViewStyles as styles } from './NavigationView.styles';
import { Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import type { NavigationViewProps } from '../src/types/NavigationView.types';
export function NavigationView({ t, direction, trigger, open, providerMode, loading, failed, managed, applicationStatus, becomeProvider, choosingBusiness, busy, error, close, onOpen, onRetry, onHome, onAccount, onApplication, onSwitchMode, onBusiness, onLogout }: NavigationViewProps) {
  return <View style={{ direction }} className="border-b border-line bg-surface">
    <View className="mx-auto w-full max-w-3xl flex-row items-center justify-between gap-3 px-5 py-2">
      <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel={t('nav.open')} accessibilityState={{ expanded: open }} onPress={onOpen} className="min-h-12 min-w-12 items-center justify-center rounded-control border border-line"><AppText style={styles.centered} className="text-2xl font-semibold text-brand">☰</AppText></Pressable>
      <AppText className="font-semibold tracking-widest text-brand">VISIT</AppText>
      {providerMode ? <AppText className="text-sm text-body">{t('nav.providerMode')}</AppText> : null}
    </View>
    {open ? <Modal transparent visible animationType="none" accessibilityLabel={t('nav.menu')} onRequestClose={close} onDismiss={() => { if (Platform.OS === 'web') trigger.current?.focus(); }}>
      <View style={[styles.overlay, { direction }]}>
        <SafeAreaView testID="menu-panel" edges={['top', 'bottom']} style={[styles.panel, { direction }]}>
          <ScrollView contentContainerStyle={styles.content}>
            <AppText accessibilityRole="header" className="text-xl font-bold text-ink">{t('nav.menu')}</AppText>
            <ActionButton secondary label={t('nav.close')} onPress={close} />
            <ActionButton secondary label={t('nav.home')} onPress={onHome} />
            <ActionButton secondary label={t('nav.account')} onPress={onAccount} />
            {loading ? <AppText>{t('account.loading')}</AppText> : null}
            {failed ? <><AppText accessibilityRole="alert">{t('account.failure')}</AppText><ActionButton secondary label={t('common.retry')} onPress={onRetry} /></> : <>
              {becomeProvider ? <ActionButton secondary label={t('account.becomeProvider')} onPress={onApplication} /> : null}
              {applicationStatus ? <ActionButton secondary label={t('account.applicationStatus')} onPress={onApplication} /> : null}
              {managed.length ? <ActionButton secondary label={t(providerMode ? 'nav.customerMode' : 'account.switchProvider')} onPress={onSwitchMode} /> : null}
              {choosingBusiness ? <View className="gap-3 rounded-control border border-line p-3"><AppText className="font-semibold">{t('nav.chooseBusiness')}</AppText>{managed.map(m => <ActionButton key={m.business.id} secondary label={m.business.name} disabled={busy} onPress={() => onBusiness(m.business.id)} />)}</View> : null}
            </>}
            <ActionButton secondary label={t('account.signOut')} busy={busy} onPress={onLogout} />
            {error ? <AppText accessibilityRole="alert" className="text-danger">{error}</AppText> : null}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal> : null}
  </View>;
}
