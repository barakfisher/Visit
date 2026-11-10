import { Redirect } from 'expo-router';
import { AppointmentAudit } from '@/components/AppointmentAudit.component';
import { PastAppointments } from '@/components/PastAppointments.component';
import { usePastAppointments } from '@/src/lib/PastAppointments.hook';
export default function PastAppointmentsRoute() {
  const view = usePastAppointments();
  // Signed out, My appointments is where signing in starts.
  if (view.signedOut) return <Redirect href="/appointments" />;
  return <PastAppointments {...view} audit={item => <AppointmentAudit key={item.id} booking={item.booking} timezone={item.booking.business.timezone} quiet hideStatus />} />;
}
