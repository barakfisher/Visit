import { useIsFocused, useLocalSearchParams } from 'expo-router';
import { BookingDetails } from '@/components/BookingDetails.component';
import { useBookingDetails } from '@/src/lib/BookingDetails.hook';
function AppointmentDetailsContent() { return <BookingDetails {...useBookingDetails('details')} />; }
export default function AppointmentDetailsRoute() {
  const focused = useIsFocused();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  return focused ? <AppointmentDetailsContent key={bookingId} /> : null;
}
