import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useAppLocale } from '../i18n/LocaleContext';
import { useSessionStore } from '../state/session';
import { readArchivedProviders, restoreSavedProvider } from './Home.service';
import type { ArchivedProvidersView } from '../types/ArchivedProviders.types';
export function useArchivedProviders(): ArchivedProvidersView {
  const { t } = useAppLocale(), client = useQueryClient(), router = useRouter();
  const identity = useSessionStore(state => state.identityId), bootstrap = useSessionStore(state => state.bootstrapStatus);
  const archived = useInfiniteQuery({ queryKey: ['my-providers', identity, 'archive'], initialPageParam: null, queryFn: ({ pageParam, signal }: { pageParam: string | null; signal: AbortSignal }) => readArchivedProviders(pageParam, signal), getNextPageParam: page => page.nextCursor ?? undefined, enabled: !!identity });
  const restore = useMutation({ mutationFn: async ({ businessId, identity }: { businessId: string; identity: string; version: number }) => restoreSavedProvider(businessId, identity), onSuccess: (_result, input) => {
    const current = useSessionStore.getState(); if (current.identityId !== input.identity || current.contextVersion !== input.version) return;
    void client.invalidateQueries({ queryKey: ['my-providers', input.identity] });
  } });
  return { t, bootstrapping: !identity && bootstrap !== 'ready', signedOut: !identity && bootstrap === 'ready', state: archived.isPending ? 'loading' : archived.isError ? 'error' : 'ready',
    providers: archived.data?.pages.flatMap(page => page.providers) ?? [], hasMore: Boolean(archived.hasNextPage), loadingMore: archived.isFetchingNextPage, restoringId: restore.isPending ? restore.variables?.businessId ?? null : null, restoreError: restore.isError,
    onRestore: businessId => { if (identity && !restore.isPending) restore.mutate({ businessId, identity, version: useSessionStore.getState().contextVersion }); },
    onRetry: () => { void archived.refetch(); }, onMore: () => { void archived.fetchNextPage(); }, onBack: () => { if (router.canGoBack()) router.back(); else router.replace('/'); },
  };
}
