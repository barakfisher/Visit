import { useAppointmentLifecycle } from '@/src/lib/AppointmentLifecycle.hook';
import type { AppointmentAuditProps } from '@/src/types/AppointmentLifecycle.types';
import { AppointmentLifecycle } from './AppointmentLifecycle.component';
export function AppointmentAudit({ booking, timezone, businessId }: AppointmentAuditProps) {
  const view = useAppointmentLifecycle(booking, timezone, businessId);
  return <AppointmentLifecycle {...view} />;
}
