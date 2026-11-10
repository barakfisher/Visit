import { WEEKDAYS, sortIntervals, type Week } from './WeeklyHours';
import type { ProviderDetail } from '../types/flows';

/** A business's own appointments, in the order given; with no business, all of them. */
export function appointmentsAt<T extends { business: { id: string } }>(items: readonly T[], businessId?: string): T[] {
  return businessId ? items.filter(item => item.business.id === businessId) : [...items];
}

export type ProviderContacts = { phone: string | null; email: string | null; location: string | null };
/** Only what the owner filled in; an empty result means the business page shows no contact card. */
export function providerContacts(provider: Pick<ProviderDetail, 'contactPhone' | 'contactEmail' | 'location'>): ProviderContacts | null {
  const clean = (value: string | null | undefined) => value?.trim() || null;
  const contacts = { phone: clean(provider.contactPhone), email: clean(provider.contactEmail), location: clean(provider.location) };
  return contacts.phone || contacts.email || contacts.location ? contacts : null;
}

/** The API's weekly rows as a week from Sunday, each day's intervals in order. */
export function providerWeek(rows: ProviderDetail['weeklyAvailability']): Week {
  return WEEKDAYS.map(day => sortIntervals(rows.filter(row => row.weekday === day).map(({ startLocal, endLocal }) => ({ startLocal, endLocal }))));
}
