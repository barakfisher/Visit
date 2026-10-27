import { useIsFocused, useLocalSearchParams } from 'expo-router';
import { BookingDetails } from '@/components/BookingDetails.component';
import { useBookingDetails } from '@/src/lib/BookingDetails.hook';
function ConfirmationContent() { return <BookingDetails {...useBookingDetails('confirmation')} />; }
export default function ConfirmationRoute() {
  const focused = useIsFocused();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  return focused ? <ConfirmationContent key={bookingId} /> : null;
}
