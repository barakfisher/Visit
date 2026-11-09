import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'expo-router';
import { useAppLocale } from '../i18n/LocaleContext';
import { useSessionStore } from '../state/session';
import { readArchivedProviders, readSavedProviders, removeSavedProvider } from './Home.service';
import { useUpcomingAppointment } from './UpcomingAppointment.hook';
import { apiRequest } from './api';
import { menuCapabilities, type AccountNavigation } from './navigation';
import { providerModeOnHome, type RememberedProviderMode } from './ProviderMode';
import { forgetProviderMode, openProviderWorkspace, readProviderMode } from './ProviderMode.service';
import type { HomeView } from '../types/Home.types';
export function useHome(): HomeView {
  const { t } = useAppLocale(), client = useQueryClient(), router = useRouter(), pathname = usePathname();
  const identity = useSessionStore(state => state.identityId), bootstrap = useSessionStore(state => state.bootstrapStatus);
  const upcoming = useUpcomingAppointment();
  const saved = useInfiniteQuery({ queryKey: ['my-providers', identity], initialPageParam: null, queryFn: ({ pageParam, signal }: { pageParam: string | null; signal: AbortSignal }) => readSavedProviders(pageParam, signal), getNextPageParam: page => page.nextCursor ?? undefined, enabled: !!identity });
  // Under the same prefix as the list, so every invalidation of the list also refreshes this.
  const archive = useQuery({ queryKey: ['my-providers', identity, 'archive-exists'], queryFn: ({ signal }) => readArchivedProviders(null, signal), select: page => page.providers.length > 0, enabled: !!identity });
  const [removeTarget, setRemoveTarget] = useState<string | null>(null);
  const remove = useMutation({ onSettled: () => setRemoveTarget(null),  mutationFn: async ({ businessId, identity }: { businessId: string; identity: string; version: number }) => removeSavedProvider(businessId, identity), onSuccess: (_result, input) => {
    const current = useSessionStore.getState(); if (current.identityId !== input.identity || current.contextVersion !== input.version) return;
    client.removeQueries({ queryKey: ['my-provider-saved', input.identity, input.businessId], exact: true }); void client.invalidateQueries({ queryKey: ['my-providers', input.identity] });
  } });
  // Same query key as the header, so both read one /v1/me answer.
  const account = useQuery({ queryKey: ['me', identity], queryFn: () => apiRequest<AccountNavigation>('/v1/me'), enabled: !!identity });
  const { managed } = menuCapabilities(account.data);
  const [remembered, setRemembered] = useState<RememberedProviderMode | null | undefined>(undefined);
  const [restoring, setRestoring] = useState(true), [opening, setOpening] = useState<string | null>(null), [businessError, setBusinessError] = useState<HomeView['businessError']>(null);
  const checked = useRef(false), mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => { if (identity) void readProviderMode().then(value => { if (mounted.current) setRemembered(value); }); }, [identity]);
  // A device that was last in provider mode reopens it when the app opens on Home, only while the server still grants it.
  // Home is the stack's anchor, so it also mounts under a deep link (/p/…, /booking/…); that link must win.
  // Without a remembered mode Home does not wait for the account.
  useEffect(() => {
    if (!identity || checked.current || remembered === undefined) return;
    const onHome = pathname === '/';
    if (onHome && remembered && remembered.identityId === identity && account.isPending) return;
    checked.current = true;
    void (async () => {
      const next = !onHome ? 'none' : account.isError || account.isPending ? providerModeOnHome(remembered, identity, null) : providerModeOnHome(remembered, identity, managed);
      if (next === 'forget') await forgetProviderMode();
      if (next === 'restore' && remembered) { try { if (await openProviderWorkspace(remembered.businessId)) return; await forgetProviderMode(); } catch { /* stay on Home; the card and menu still work */ } }
      if (mounted.current) setRestoring(false);
    })();
  }, [identity, remembered, pathname, account.isPending, account.isError, managed]);
  async function manage(businessId: string) {
    if (opening) return;
    setOpening(businessId); setBusinessError(null);
    try { if (!await openProviderWorkspace(businessId)) { setBusinessError('nav.changed'); void account.refetch(); } } catch { if (mounted.current) setBusinessError('home.business.failure'); } finally { if (mounted.current) setOpening(null); }
  }
  return { t, identity, bootstrapping: !identity && bootstrap !== 'ready' || !!identity && restoring, upcoming,
    businesses: managed.map(m => ({ id: m.business.id, name: m.business.name, published: !!m.business.publishedAt })), openingBusiness: opening, businessError, onManage: businessId => { void manage(businessId); },
    providersState: saved.isPending ? 'loading' : saved.isError ? 'error' : 'ready', providers: saved.data?.pages.flatMap(page => page.providers) ?? [], hasMore: Boolean(saved.hasNextPage), loadingMore: saved.isFetchingNextPage, removingId: remove.isPending ? remove.variables?.businessId ?? null : null, removeError: remove.isError,
    onRetryProviders: () => { void saved.refetch(); }, onMore: () => { void saved.fetchNextPage(); },
    onBook: businessId => router.push({ pathname: '/booking/[providerId]', params: { providerId: businessId } }), hasArchive: archive.data === true, onArchive: () => router.push('/archived-providers'),
    removeName: removeTarget ? saved.data?.pages.flatMap(page => page.providers).find(item => item.businessId === removeTarget)?.provider.name ?? null : null,
    onRemove: businessId => { if (!remove.isPending) { remove.reset(); setRemoveTarget(businessId); } }, onCancelRemove: () => { if (!remove.isPending) setRemoveTarget(null); },
    onConfirmRemove: () => { if (identity && removeTarget && !remove.isPending) remove.mutate({ businessId: removeTarget, identity, version: useSessionStore.getState().contextVersion }); },
  };
}
