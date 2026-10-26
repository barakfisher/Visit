import { Link } from 'expo-router';
import { Platform, Pressable, TextInput, View } from 'react-native';
import { ActionButton } from '../ActionButton';
import { AppText as Text } from '../AppText';
import { OTPInput } from './OTPInput';
import { GoogleSigninButton } from './GoogleSigninButton';
import type { useAccountMethods } from './AccountMethods.hook';
export function AccountMethodsView(props: ReturnType<typeof useAccountMethods>) {
  const { reauthReturnTo, onReauthenticate, t, locale, methods, capabilities, channel, setChannel, destination, setDestination, challenge, code, setCode, cooldown, removing, setRemoving, issued, busy, error, setError, success, reauth, resetDraft, start, finish, loadLocalCode, available, valid, contactOnly } = props;
  return <View className="gap-4 rounded-card border border-line bg-surface p-card">
    <Text accessibilityRole="header" className="text-xl font-bold text-ink">{t('methods.title')}</Text>
    <Text className="text-sm leading-5 text-body">{t('methods.intro')}</Text>
    {methods.isLoading ? <Text accessibilityRole="status">{t('common.loading')}</Text> : methods.isError ? <ActionButton secondary label={t('common.retry')} onPress={() => void methods.refetch()} /> : <>
      {reauth ? <View className="gap-2"><Text className="text-warning">{t('methods.reauth')}</Text><Link onPress={onReauthenticate} href={{ pathname: '/auth/login', params: reauthReturnTo ? { returnTo: reauthReturnTo } : {} }} className="font-semibold text-brand">{t('methods.signInAgain')}</Link></View> : null}
      {methods.data?.methods.filter(method => !contactOnly || method.method !== 'google').map(method => <View key={method.id} className="gap-2 rounded-control border border-line p-4">
        <Text className="font-semibold text-ink">{t(`methods.${method.method}`)} · {t(method.verified ? 'methods.verified' : 'methods.unverified')}</Text>
        {method.label ? <Text style={{ writingDirection: 'ltr', textAlign: 'left' }} className="text-body">{method.label}</Text> : null}
        {!contactOnly ? <ActionButton secondary disabled={reauth || busy || Boolean(issued) || !method.canRemove} label={t(method.canRemove ? 'methods.remove' : 'methods.last')} onPress={() => { setRemoving(method); setError(''); }} /> : null}
      </View>)}
      {issued ? <ActionButton label={t('methods.resume')} busy={busy} onPress={() => void finish()} /> : removing ? <View className="gap-3 rounded-control border border-line p-4"><Text className="text-body">{t('methods.removeHelp')}</Text><ActionButton label={t('methods.confirmRemove')} busy={busy} onPress={() => void finish(removing)} /><ActionButton secondary label={t('catalog.cancel')} disabled={busy} onPress={() => setRemoving(null)} /></View> : <>
        <Text className="font-semibold text-ink">{t('methods.change')}</Text>
        <View accessibilityLabel={t('methods.choose')} className="flex-row gap-3">{(['email', 'phone'] as const).map(value => <Pressable key={value} accessibilityRole="button" aria-pressed={channel === value} accessibilityState={{ disabled: busy }} disabled={busy} className={`min-h-12 flex-1 justify-center rounded-control border p-3 ${channel === value ? 'border-brand bg-brand-soft' : 'border-line'}`} onPress={() => { setChannel(value); setDestination(''); resetDraft(); }}><Text className="font-semibold text-brand">{t(`methods.${value}`)}</Text></Pressable>)}</View>
        {challenge ? <>
          <Text className="text-body">{t('methods.codeSent')}</Text><Text style={{ writingDirection: 'ltr', textAlign: 'left' }} className="font-semibold text-ink">{destination}</Text><OTPInput value={code} onChange={setCode} />
          <ActionButton label={t('methods.verify')} busy={busy} disabled={reauth || code.length !== 6} onPress={() => void finish()} />
          {__DEV__ ? <ActionButton secondary label={t('methods.localCode')} busy={busy} onPress={() => void loadLocalCode()} /> : null}
          <ActionButton secondary label={t('methods.restart')} disabled={busy} onPress={resetDraft} />
        </> : <>
          <TextInput value={destination} onChangeText={setDestination} editable={available && !reauth && !busy} accessibilityLabel={t(channel === 'email' ? 'methods.newEmail' : 'methods.newPhone')} autoComplete={channel === 'email' ? 'email' : 'tel'} keyboardType={channel === 'email' ? 'email-address' : 'phone-pad'} autoCapitalize="none" autoCorrect={false} placeholder={channel === 'email' ? 'you@example.com' : '+972501234567'} style={{ writingDirection: 'ltr', textAlign: 'left' }} className="rounded-control border border-line px-4 py-4 text-ink" />
          <ActionButton label={!available ? t('methods.unavailable') : cooldown ? t('methods.resendIn', { seconds: cooldown }) : t('methods.send')} busy={busy} disabled={!available || reauth || !valid || cooldown > 0} onPress={() => void start()} />
        </>}
        {!contactOnly ? <GoogleSigninButton intent="link" disabled={reauth || busy} enabled={Platform.OS === 'web' ? capabilities.data?.google : capabilities.data?.googleNative} onError={setError} /> : null}
      </>}
      {success ? <Text accessibilityRole="status" className="text-brand">{t('methods.saved')}</Text> : null}
      {!contactOnly && methods.data?.events.length ? <View className="gap-3"><Text className="font-semibold text-ink">{t('methods.history')}</Text>{methods.data.events.map(event => <View key={event.id} className="gap-1 border-t border-line pt-3"><Text className="text-sm text-body">{t(`methods.${event.method}`)} · {t(`methods.${event.action}`)}</Text><Text className="text-xs text-muted">{new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.createdAt))}</Text>{event.notifications.map((notification, index) => <Text key={index} className="text-xs text-muted">{t(`methods.${notification.channel}`)} · {t(notification.status === 'ACCEPTED' && notification.provider === 'local-inbox' ? 'methods.localAlert' : `methods.${notification.status}`)}</Text>)}</View>)}</View> : null}
    </>}
    {error ? <Text accessibilityRole="alert" className="text-danger">{error}</Text> : null}
    <Text className="text-sm leading-5 text-body">{t('methods.recoveryHelp')}</Text><ActionButton secondary disabled label={t('methods.recovery')} />
  </View>;
}
