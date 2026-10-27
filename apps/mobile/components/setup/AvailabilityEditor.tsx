import { ScheduleEditor } from '../ScheduleEditor.component';
import { useScheduleEditor } from '@/src/lib/ScheduleEditor.hook';
export function AvailabilityEditor({ businessId, staffId }: { businessId: string; staffId?: string }) { return <ScheduleEditor {...useScheduleEditor(businessId, staffId)} />; }
