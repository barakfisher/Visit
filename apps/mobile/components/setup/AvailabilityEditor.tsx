import { ScheduleEditor } from '../ScheduleEditor.component';
import { useScheduleEditor } from '@/src/lib/ScheduleEditor.hook';
export function AvailabilityEditor({ businessId, staffId, onSaved }: { businessId: string; staffId?: string; onSaved?: () => void }) { return <ScheduleEditor {...useScheduleEditor(businessId, staffId, onSaved)} />; }
