import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useAppLocale } from '../i18n/LocaleContext';
import { useSessionStore } from '../state/session';
import type { AuthProfile } from '../types/flows';
import { apiRequest } from './api';
import { markNotificationsRead, readNotifications } from './Notifications.service';
import { readSessionToken } from './sessionToken';
import { notificationListKey, notificationRow, rowsToMark, unreadKey } from './Notifications.utils';
import { forgetProviderMode, openProviderWorkspace } from './ProviderMode.service';
import type { NotificationRow, NotificationsView } from '../types/Notifications.types';

type ListAnswer = Awaited<ReturnType<typeof readNotifications>>;

/** The route unmounts this when it loses focus, which is what ends "new" for what was seen. */
export function useNotifications(): NotificationsView {
  const { t, locale } = useAppLocale(), client = useQueryClient();
  const identity = useSessionStore(state => state.identityId), bootstrap = useSessionStore(state => state.bootstrapStatus);
  const list = useQuery({ queryKey: notificationListKey(identity), queryFn: ({ signal }) => readNotifications(signal), enabled: !!identity, staleTime: 0 });
  const [seenAsNew, setSeenAsNew] = useState<ReadonlySet<string>>(() => new Set());
  const [openingId, setOpeningId] = useState<string | null>(null), [openError, setOpenError] = useState<NotificationsView['openError']>(null);
  const sent = useRef(new Set<string>()), marked = useRef(false);
  // Another tab may have switched account: the cookie then answers for someone else, while this tab still believes it is signed in as before.
  // Showing that inbox here, or marking it read, would clear someone's only alert without them seeing it.
  const mismatched = !!list.data && list.data.identityId !== identity, notifications = mismatched ? undefined : list.data?.notifications;
  useEffect(() => {
    if (!mismatched) return;
    // Home, not this page: staying here would open the new account's inbox for them, and mark it read.
    void apiRequest<{ profile: AuthProfile }>('/api/auth/me').then(async ({ profile }) => { useSessionStore.getState().setAuth(await readSessionToken(), profile); router.replace('/'); }).catch(() => {});
  }, [mismatched]);

  // Only rows on screen are marked, so one that arrives after this read stays unread until it is shown too.
  // A failed mark says nothing: the rows stay unread and the next opening tries again.
  useEffect(() => {
    if (!notifications || !identity) return;
    const ids = rowsToMark(notifications, sent.current, marked.current);
    if (!ids) return;
    const unread = notifications.filter(item => !item.read && !sent.current.has(item.id)).map(item => item.id);
    marked.current = true;
    for (const id of unread) sent.current.add(id);
    // Holds what the server is about to forget, so it stays highlighted.
    if (unread.length) setSeenAsNew(current => new Set([...current, ...unread]));
    void markNotificationsRead(ids).then(async ({ unread: count }) => {
      if (useSessionStore.getState().identityId !== identity) return;
      // A count read that started before this mark must not bring the old circle back.
      await client.cancelQueries({ queryKey: unreadKey(identity) });
      client.setQueryData(unreadKey(identity), { unread: count });
      // Or reopening within the cache's lifetime would call these rows new again.
      client.setQueryData<ListAnswer>(notificationListKey(identity), answer => answer && { ...answer, notifications: answer.notifications.map(item => ids.includes(item.id) ? { ...item, read: true } : item) });
    }).catch(() => {});
  }, [notifications, identity, client]);

  const rows = useMemo(() => (notifications ?? []).map(item => notificationRow(item, locale, seenAsNew.has(item.id))), [notifications, locale, seenAsNew]);

  async function open({ id, target }: NotificationRow) {
    if (openingId) return;
    setOpenError(null);
    if (target.to === 'business') {
      setOpeningId(id);
      try {
        if (!await openProviderWorkspace(target.businessId, target.date)) { setOpenError('nav.changed'); void list.refetch(); }
      } catch { setOpenError('notifications.openFailure'); } finally { setOpeningId(null); }
      return;
    }
    // These belong to the person, so they open in customer mode whichever mode the bell was opened from.
    useSessionStore.getState().selectBusiness(null);
    await forgetProviderMode();
    if (target.to === 'appointment') router.push({ pathname: '/appointment/[bookingId]', params: { bookingId: target.bookingId } });
    else router.navigate('/register/provider');
  }

  return { t, bootstrapping: !identity && bootstrap !== 'ready', signedOut: !identity && bootstrap === 'ready',
    // A failed re-read keeps the list it has: only a first read that fails has nothing to show.
    state: list.isPending || mismatched ? 'loading' : !list.data ? 'error' : 'ready',
    rows, openingId, openError, onOpen: row => { void open(row); }, onRetry: () => { void list.refetch(); } };
}
