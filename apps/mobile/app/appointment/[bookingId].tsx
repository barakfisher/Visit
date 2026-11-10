import { useIsFocused, useLocalSearchParams } from 'expo-router';
import { AppointmentAudit } from '@/components/AppointmentAudit.component';
import { BookingDetails } from '@/components/BookingDetails.component';
import { useBookingDetails } from '@/src/lib/BookingDetails.hook';
// The change history lives here, on the appointment's own screen, rather than on every card in My appointments.
function AppointmentDetailsContent() {
  const view = useBookingDetails('details');
  return <BookingDetails {...view} history={view.booking ? <AppointmentAudit key={view.booking.id} booking={view.booking} timezone={view.booking.business.timezone} quiet hideStatus /> : null} />;
}
export default function AppointmentDetailsRoute() {
  const focused = useIsFocused();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  return focused ? <AppointmentDetailsContent key={bookingId} /> : null;
}
