import { useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { watchForegroundReturn } from './LiveSignals.service';

/**
 * Runs when the customer comes back to this screen: from another screen, or from outside the app.
 * Coming back from outside to a covered screen does nothing here; that screen's own return covers it.
 */
export function useScreenReturn(onReturn: () => void) {
  const focused = useIsFocused();
  const latest = useRef(onReturn), wasFocused = useRef(focused);
  useEffect(() => { latest.current = onReturn; }, [onReturn]);
  useEffect(() => {
    if (focused && !wasFocused.current) latest.current();
    wasFocused.current = focused;
  }, [focused]);
  useEffect(() => {
    const returned = watchForegroundReturn(AppState.currentState, () => { if (wasFocused.current) latest.current(); });
    const subscription = AppState.addEventListener('change', returned);
    return () => subscription.remove();
  }, []);
}
