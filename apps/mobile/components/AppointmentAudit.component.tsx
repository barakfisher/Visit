import { useAppointmentLifecycle } from '@/src/lib/AppointmentLifecycle.hook';
import type { AppointmentAuditProps } from '@/src/types/AppointmentLifecycle.types';
import { AppointmentLifecycle } from './AppointmentLifecycle.component';
export function AppointmentAudit({ booking, timezone, businessId, quiet = false, hideStatus = false, open, readOnly = false }: AppointmentAuditProps) {
  const view = useAppointmentLifecycle(booking, timezone, businessId, open, !readOnly);
  return <AppointmentLifecycle {...view} quiet={quiet} hideStatus={hideStatus} hideToggle={open !== undefined} />;
}
