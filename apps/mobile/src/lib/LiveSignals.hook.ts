import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionStore } from '../state/session';
import { apiRequest } from './api';
import { isCustomerAppointmentQuery } from './BookingQueries.utils';
import { followLiveSignals, shareLiveSignals, watchForegroundReturn } from './LiveSignals.service';
import { queryClient } from './queryClient';

/** Holds a stream only while signed in and in the foreground. Returning to the app reconnects, and connecting re-reads. */
function useLiveSignals(path: string, enabled: boolean, onChange: () => void) {
  const identity = useSessionStore(state => state.identityId), version = useSessionStore(state => state.contextVersion);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const latest = useRef(onChange);
  useEffect(() => { latest.current = onChange; }, [onChange]);
  useEffect(() => {
    const returned = watchForegroundReturn(AppState.currentState, () => latest.current());
    const subscription = AppState.addEventListener('change', state => { setForeground(state === 'active'); returned(state); });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!enabled || !foreground || !identity) return;
    const controller = new AbortController();
    void shareLiveSignals({
      name: `visit-live:${identity}:${path}`,
      follow: (onChange, signal) => followLiveSignals({ open: connection => apiRequest.openStream(path, connection), onChange, signal }),
      onChange: () => latest.current(),
      signal: controller.signal,
    });
    return () => controller.abort();
  }, [enabled, foreground, identity, path, version]);
}

/** Re-reads the open agenda when the server says it changed. */
export function useLiveAgenda(businessId: string, enabled: boolean) {
  const client = useQueryClient();
  useLiveSignals(`/api/provider/agenda/live?businessId=${encodeURIComponent(businessId)}`, enabled, () => {
    void client.invalidateQueries({ queryKey: ['provider', businessId, 'agenda'] });
  });
}

/** One stream for the whole signed-in app: only the customer appointment queries on screen re-read. */
export function useLiveAppointments() {
  useLiveSignals('/api/me/appointments/live', true, () => {
    void queryClient.invalidateQueries({ predicate: query => isCustomerAppointmentQuery(query.queryKey) });
  });
}
