import { ApiError } from './apiClient';
import type { BlockConflict } from '../types/TimeBlocks.types';

/** The API's limits (`apps/api/src/routes/providers.ts`, staff routes). */
export const MIN_CAPACITY = 1;
export const MAX_CAPACITY = 100;
/**
 * Capacity is hidden while every staff member takes one appointment at a time (decisions.md, 2026-11-11).
 * The server still stores and enforces it, a new staff member starts at MIN_CAPACITY, and an existing value is kept on save.
 * Turning this back on restores the field, the card line and the manual-booking label.
 */
export const STAFF_CAPACITY_SHOWN = false;
export const MIN_STAFF_NAME = 2;
export const MAX_STAFF_NAME = 120;
export const STAFF_HAS_APPOINTMENTS = 'STAFF_HAS_APPOINTMENTS';

export type RosterService = { id: string; name: string; active: boolean };
export type RosterStaff = { id: string; displayName: string; active: boolean; parallelCapacity: number; services: { serviceId: string; service: { id: string; name: string } }[] };
/** The add dialog and the "General" tab. Capacity stays text so a half-typed value is never coerced. */
export type StaffDraft = { name: string; capacity: string; serviceIds: string[]; active: boolean };
export type StaffDraftError = 'name' | 'services' | 'capacity' | 'capacityInUse';
export type StaffDraftErrors = Partial<Record<'name' | 'services' | 'capacity', StaffDraftError>>;
export type StaffRemovalConflicts = { total: number; timezone: string; conflicts: Extract<BlockConflict, { kind: 'APPOINTMENT' }>[] };

export function emptyStaffDraft(): StaffDraft { return { name: '', capacity: String(MIN_CAPACITY), serviceIds: [], active: true }; }

/** "Add myself": a solo owner usually gives every service, under the name on their account (decisions.md, 2026-11-03). */
export function selfStaffDraft(accountName: string | null | undefined, services: readonly RosterService[]): StaffDraft {
  return { name: accountName?.trim() ?? '', capacity: String(MIN_CAPACITY), serviceIds: services.filter(service => service.active).map(service => service.id), active: true };
}

/** Only services that can still be assigned are pre-selected, so saving never sends a paused one back. */
export function staffDraft(staff: RosterStaff, services: readonly RosterService[]): StaffDraft {
  const assignable = new Set(services.filter(service => service.active).map(service => service.id));
  return { name: staff.displayName, capacity: String(staff.parallelCapacity), serviceIds: staff.services.map(link => link.serviceId).filter(id => assignable.has(id)), active: staff.active };
}

/** Letters, signs, spaces and decimal points never reach the field, typed or pasted. */
export function capacityText(text: string) { return text.replace(/[^0-9]/g, '').slice(0, String(MAX_CAPACITY).length); }

export function validateStaffDraft(draft: StaffDraft): StaffDraftErrors {
  const errors: StaffDraftErrors = {}, name = draft.name.trim(), capacity = Number(draft.capacity);
  if (name.length < MIN_STAFF_NAME || name.length > MAX_STAFF_NAME) errors.name = 'name';
  if (!draft.serviceIds.length) errors.services = 'services';
  if (!/^[0-9]+$/.test(draft.capacity) || capacity < MIN_CAPACITY || capacity > MAX_CAPACITY) errors.capacity = 'capacity';
  return errors;
}

/** A new staff member is never sent `active`; the switch exists only when editing. */
export function staffInput(draft: StaffDraft, editing: boolean) {
  return { displayName: draft.name.trim(), serviceIds: draft.serviceIds, parallelCapacity: Number(draft.capacity), ...(editing ? { active: draft.active } : {}) };
}

/** The server refuses a capacity below what is already booked at one time with a plain 409. */
export function isCapacityInUse(error: unknown) { return error instanceof ApiError && error.status === 409 && error.code === 'CONFLICT'; }

/** The upcoming appointments that refused a removal, or null for any other failure. */
export function staffRemovalConflicts(error: unknown): StaffRemovalConflicts | null {
  if (!(error instanceof ApiError) || error.code !== STAFF_HAS_APPOINTMENTS) return null;
  const details = error.details as Partial<StaffRemovalConflicts> | undefined;
  return { total: typeof details?.total === 'number' ? details.total : 0, timezone: typeof details?.timezone === 'string' ? details.timezone : '', conflicts: Array.isArray(details?.conflicts) ? details.conflicts : [] };
}

/** The card's chips: every assigned service by name, in the catalog's alphabetical order. */
export function assignedServiceNames(staff: RosterStaff, locale: string) {
  return staff.services.map(link => link.service.name).sort((a, b) => a.localeCompare(b, locale));
}
