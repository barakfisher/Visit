import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customerSearchKind } from '@visit/contracts';
import { searchCustomerCards } from './ManualBooking.service';
import { internationalPhone } from './PhoneNumber';
import type { CustomerCardSummary } from '../types/ManualBooking.types';

/** Typing pauses this long before the sheet searches, so each keystroke is not a request. */
export const CUSTOMER_SEARCH_DEBOUNCE_MS = 300;

function useSettled(value: string) {
  const [settled, setSettled] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setSettled(value), CUSTOMER_SEARCH_DEBOUNCE_MS); return () => clearTimeout(timer); }, [value]);
  return settled;
}

/**
 * Suggestions for the customer field from this business's own cards (customer-cards.md), and the card a typed phone
 * already belongs to. Nothing searches while a card is picked or the sheet is closed.
 */
export function useCustomerCardSearch({ businessId, identity, version, enabled, name, phone }: { businessId: string; identity: string | null; version: number; enabled: boolean; name: string; phone: string }) {
  const term = useSettled(name.trim()), e164 = internationalPhone(useSettled(phone));
  const kind = customerSearchKind(term), searched = enabled && (kind.byName || kind.byPhone);
  const byName = useQuery({ queryKey: ['provider', businessId, 'customer-cards', identity, version, term], queryFn: ({ signal }) => searchCustomerCards(businessId, term, signal), enabled: searched, staleTime: 30_000, retry: false });
  const byPhone = useQuery({ queryKey: ['provider', businessId, 'customer-cards', identity, version, e164], queryFn: ({ signal }) => searchCustomerCards(businessId, e164 ?? '', signal), enabled: enabled && Boolean(e164), staleTime: 30_000, retry: false });
  const phoneMatch: CustomerCardSummary | null = e164 ? byPhone.data?.cards.find(card => card.phone === e164) ?? null : null;
  return {
    suggestions: searched ? byName.data?.cards ?? [] : [],
    // A settled term that has not answered yet, or typing that has not settled, both read as searching.
    searching: searched && (byName.isFetching || term !== name.trim()),
    searchError: searched && byName.isError,
    searched,
    phoneMatch,
    retry: () => { void byName.refetch(); },
  };
}
