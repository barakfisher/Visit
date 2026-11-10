import { ScrollView } from 'react-native';
import { ManualBooking } from '@/components/ManualBooking.component';
import { useManualBookingScreen } from '@/src/lib/ManualBooking.hook';
/** Its own screen so the footer marks Add appointment, not Home, and the agenda does not show behind the form. */
export default function AddAppointment() {
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="mx-auto w-full max-w-3xl gap-5 px-5 py-6 pb-10" className="flex-1 bg-canvas"><ManualBooking {...useManualBookingScreen()} /></ScrollView>;
}
