import { Appointments } from '@/components/Appointments.component';
import { useAppointments } from '@/src/lib/Appointments.hook';
export default function AppointmentsRoute() { return <Appointments {...useAppointments()} />; }
