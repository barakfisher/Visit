import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useAppLocale } from '../i18n/LocaleContext';
import { useSessionStore } from '../state/session';
import { readSavedProviders, removeSavedProvider } from './Home.service';
import { useUpcomingAppointment } from './UpcomingAppointment.hook';
import type { HomeView } from '../types/Home.types';
export function useHome(): HomeView {
  const { t } = useAppLocale(), client = useQueryClient(), router = useRouter();
  const identity = useSessionStore(state => state.identityId), bootstrap = useSessionStore(state => state.bootstrapStatus);
  const upcoming = useUpcomingAppointment();
  const saved = useInfiniteQuery({ queryKey: ['my-providers', identity], initialPageParam: null, queryFn: ({ pageParam, signal }: { pageParam: string | null; signal: AbortSignal }) => readSavedProviders(pageParam, signal), getNextPageParam: page => page.nextCursor ?? undefined, enabled: !!identity });
  const remove = useMutation({ mutationFn: async ({ businessId, identity }: { businessId: string; identity: string; version: number }) => removeSavedProvider(businessId, identity), onSuccess: (_result, input) => {
    const current = useSessionStore.getState(); if (current.identityId !== input.identity || current.contextVersion !== input.version) return;
    client.removeQueries({ queryKey: ['my-provider-saved', input.identity, input.businessId], exact: true }); void client.invalidateQueries({ queryKey: ['my-providers', input.identity] });
  } });
  return { t, identity, bootstrapping: !identity && bootstrap !== 'ready', upcoming,
    providersState: saved.isPending ? 'loading' : saved.isError ? 'error' : 'ready', providers: saved.data?.pages.flatMap(page => page.providers) ?? [], hasMore: Boolean(saved.hasNextPage), loadingMore: saved.isFetchingNextPage, removingId: remove.isPending ? remove.variables?.businessId ?? null : null, removeError: remove.isError,
    onAppointments: () => router.push('/appointments'), onRetryProviders: () => { void saved.refetch(); }, onMore: () => { void saved.fetchNextPage(); },
    onBook: businessId => router.push({ pathname: '/booking/[providerId]', params: { providerId: businessId } }), onRemove: businessId => { if (identity && !remove.isPending) remove.mutate({ businessId, identity, version: useSessionStore.getState().contextVersion }); },
  };
}
