import { BusinessCalendar } from '@/components/BusinessCalendar.component';
import { useBusinessCalendar } from '@/src/lib/BusinessCalendar.hook';
/** The business calendar: a week or a day (decisions.md, "The calendar screen" — 2026-11-11). */
export default function ProviderCalendar() { return <BusinessCalendar {...useBusinessCalendar()} />; }
