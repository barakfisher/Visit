import { parseServicePrice, type ServiceInput } from '@visit/contracts';

/** One currency per provider for now; the API still stores it per service (decisions.md, 2026-11-02). */
export const DEFAULT_SERVICE_CURRENCY = 'ILS';
export type CatalogService = { id: string; name: string; description: string | null; durationMinutes: number; priceMinor: number | null; currency: string | null; active: boolean };
export type ServiceDraft = { name: string; description: string; duration: string; price: string; currency: string; active: boolean };

export const emptyServiceDraft = (): ServiceDraft => ({ name: '', description: '', duration: '30', price: '', currency: DEFAULT_SERVICE_CURRENCY, active: true });
/** Editing keeps a service's stored currency, so a legacy non-ILS row is never silently relabelled. */
export function serviceDraft(service: CatalogService): ServiceDraft {
  return { name: service.name, description: service.description ?? '', duration: String(service.durationMinutes), price: service.priceMinor === null ? '' : (service.priceMinor / 100).toFixed(2), currency: service.currency ?? DEFAULT_SERVICE_CURRENCY, active: service.active };
}
/** Unparseable numbers become NaN so the shared contract reports them on the right field. */
export function serviceInput(draft: ServiceDraft, editing: boolean): ServiceInput {
  const priceMinor = parseServicePrice(draft.price);
  return {
    name: draft.name, description: draft.description.trim() || null,
    durationMinutes: /^\d+$/.test(draft.duration.trim()) ? Number(draft.duration) : NaN,
    priceMinor: priceMinor === undefined ? NaN : priceMinor, currency: draft.price.trim() ? draft.currency : null,
    ...(editing ? { active: draft.active } : {}),
  };
}
