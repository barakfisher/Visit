import { BookingContactFlow } from '@/components/BookingContactFlow.component';
import { useBookingContactFlow } from '@/src/lib/BookingContactFlow.hook';
export default function BookingScreen() { return <BookingContactFlow {...useBookingContactFlow()} />; }
