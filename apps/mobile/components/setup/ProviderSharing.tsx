import { useMemo, useRef, useState } from 'react';
import { Platform, Share, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import * as Clipboard from 'expo-clipboard';
import { useQuery } from '@tanstack/react-query';
import { AppText } from '../AppText';
import { ActionButton } from '../ActionButton';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { apiRequest } from '@/src/lib/api';
import { providerQr } from '@/src/lib/providerQr';
export function ProviderSharing({ businessId }: { businessId: string }) {
  const { t } = useAppLocale();
  const query = useQuery({ queryKey: ['provider', businessId, 'sharing'], queryFn: () => apiRequest<{ available: boolean; url: string | null }>(`/v1/provider/businesses/${businessId}/sharing`) });
  const sharingUrl = query.data?.url;
  const qr = useMemo(() => { try { return sharingUrl ? providerQr(sharingUrl) : undefined; } catch { return undefined; } }, [sharingUrl]);
  const running = useRef(false);
  const [feedback, setFeedback] = useState<'copied' | 'error' | ''>(''), [busy, setBusy] = useState(false);
  const shareSupported = Platform.OS !== 'web' || typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  async function act(action: 'copy' | 'share' | 'qr') {
    if (running.current || !query.data?.available || !query.data.url || !qr) return;
    running.current = true; setBusy(true); setFeedback('');
    try {
      if (action === 'copy') { if (!await Clipboard.setStringAsync(query.data.url)) throw new Error('Clipboard unavailable'); setFeedback('copied'); }
      else if (action === 'share') { if (Platform.OS === 'web') await navigator.share({ url: query.data.url }); else await Share.share({ message: query.data.url, url: query.data.url }); }
      else if (Platform.OS === 'web') {
        const url = URL.createObjectURL(new Blob([qr.svg], { type: 'image/svg+xml' })); const a = document.createElement('a'); a.href = url; a.download = 'visit-booking-qr.svg'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const { File, Paths } = await import('expo-file-system'); const Sharing = await import('expo-sharing');
        if (!await Sharing.isAvailableAsync()) throw new Error('Unavailable');
        const file = new File(Paths.cache, 'visit-booking-qr.svg'); file.create({ overwrite: true }); file.write(qr.svg); await Sharing.shareAsync(file.uri, { mimeType: 'image/svg+xml' });
      }
    } catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) setFeedback('error'); } finally { running.current = false; setBusy(false); }
  }
  return <View className="gap-4">
    <AppText>{t('setup.shareHint')}</AppText>
    {query.isError || query.data?.available && !qr ? <><AppText accessibilityRole="alert">{t('setup.shareUnavailable')}</AppText><ActionButton secondary label={t('common.retry')} onPress={() => void query.refetch()} /></> : !query.data ? <AppText>{t('common.loading')}</AppText> : !query.data.available ? <AppText>{t('setup.shareLocked')}</AppText> : <>
      <AppText selectable testID="provider-sharing-url" style={{ writingDirection: 'ltr' }}>{query.data.url}</AppText>
      {qr ? <View style={{ alignSelf: 'center', backgroundColor: 'white', maxWidth: '100%' }}><Svg testID="provider-sharing-qr" accessibilityLabel={t('setup.qr')} accessible role="img" width={240} height={240} viewBox={`0 0 ${qr.size} ${qr.size}`}><Rect width={qr.size} height={qr.size} fill="white" /><Path d={qr.path} fill="black" /></Svg></View> : null}
    </>}
    <ActionButton secondary label={t('setup.copy')} disabled={!query.data?.available || !qr || busy} onPress={() => void act('copy')} />
    <ActionButton secondary label={t(shareSupported ? 'setup.share' : 'setup.shareUnsupported')} disabled={!query.data?.available || !qr || !shareSupported || busy} onPress={() => void act('share')} />
    <ActionButton secondary label={t('setup.downloadQr')} disabled={!query.data?.available || !qr || busy} onPress={() => void act('qr')} />
    {feedback ? <AppText accessibilityRole={feedback === 'error' ? 'alert' : 'status'}>{t(feedback === 'copied' ? 'setup.copied' : 'setup.shareFailure')}</AppText> : null}
  </View>;
}
