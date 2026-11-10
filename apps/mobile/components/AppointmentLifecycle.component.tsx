import { View } from 'react-native';
import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { Control } from './Control';
import type { LifecycleView } from '@/src/types/AppointmentLifecycle.types';
export function AppointmentLifecycle({ quiet = false, hideStatus = false, ...view }: LifecycleView & { quiet?: boolean; hideStatus?: boolean }) {
  return <View className="gap-3">{hideStatus ? null : <AppText className="font-semibold text-brand">{view.status}</AppText>}
    <View className="flex-row flex-wrap gap-2">{view.onComplete ? <ActionButton secondary label={view.completeLabel} disabled={view.busy} onPress={view.onComplete} /> : null}{view.onNoShow ? <ActionButton secondary label={view.noShowLabel} disabled={view.busy} onPress={view.onNoShow} /> : null}{view.onCancel ? <ActionButton secondary label={view.cancelLabel} disabled={view.busy} onPress={view.onCancel} /> : null}</View>
    {quiet ? <Control accessibilityRole="button" aria-expanded={view.expanded} accessibilityState={{ expanded: view.expanded }} onPress={view.onToggle} className="justify-center self-start"><AppText className="text-sm font-semibold text-brand">{view.toggleLabel}</AppText></Control> : <ActionButton secondary label={view.toggleLabel} onPress={view.onToggle} />}
    {view.error ? <View className="gap-2"><AppText accessibilityRole="alert" className="text-danger">{view.error}</AppText><ActionButton secondary label={view.retryLabel} onPress={view.onRetry} /></View> : null}
    {view.expanded ? view.loading ? <AppText role="status">{view.loadingLabel}</AppText> : !view.events.length ? <AppText>{view.empty}</AppText> : <View className="gap-3">{view.events.map(event => <View key={event.id} className="gap-1 border-t border-line pt-3"><AppText className="font-semibold text-ink">{event.action}</AppText><AppText className="text-sm text-muted">{event.recorded}</AppText><AppText>{event.detail}</AppText><AppText className="text-sm text-muted">{event.source}</AppText></View>)}</View> : null}
  </View>;
}
