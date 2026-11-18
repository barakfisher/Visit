import { randomUUID } from 'expo-crypto';
import * as Clipboard from 'expo-clipboard';
import { StaffAccessSection } from './StaffAccess.component';
import { useStaffRoster } from '@/src/lib/StaffRoster.hook';
import { AvailabilityEditor } from './setup/AvailabilityEditor';
import { StaffRosterView } from './StaffRoster.component';

/** Staff settings, with each staff member's weekly hours in their card's "Hours" tab and their app access on the card. */
export function StaffRoster({ businessId }: { businessId: string }) {
  return <StaffRosterView {...useStaffRoster(businessId, randomUUID)} hours={staffId => <AvailabilityEditor businessId={businessId} staffId={staffId} />}
    access={row => <StaffAccessSection businessId={businessId} row={row} copy={Clipboard.setStringAsync} />} />;
}
