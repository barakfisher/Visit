import type { MessageKey } from '../i18n/messages';

export const SETUP_SECTIONS = ['profile', 'services', 'hours', 'staff', 'policy', 'publish'] as const;
export type SetupSection = (typeof SETUP_SECTIONS)[number];
/** The steps a business completes before it can publish; publishing is the last step. */
export const REQUIRED_SECTIONS = ['profile', 'services', 'hours', 'staff', 'policy'] as const satisfies readonly SetupSection[];
/** Sections holding one form return to the settings hub on save; services and staff are lists the owner adds to repeatedly. */
export const RETURNS_ON_SAVE = ['profile', 'hours', 'policy'] as const satisfies readonly SetupSection[];
export type BusinessReadiness = { ready: boolean; publishedAt: string | null; blockers: Record<string, string>; hasAppointments: boolean };

export const blockerMessages: Record<string, MessageKey> = { ADMIN_APPROVAL_REQUIRED: 'publish.approval', ISRAEL_TIME_REVIEW_REQUIRED: 'publish.timezone', COMPLETE_BUSINESS_PROFILE: 'publish.profile', ACTIVE_SERVICE_REQUIRED: 'publish.services', EXPLICIT_POLICY_REQUIRED: 'publish.policy', WORKING_HOURS_REQUIRED: 'publish.hours', ASSIGNED_ACTIVE_STAFF_REQUIRED: 'publish.staff', SERVICE_AND_BUFFERS_MUST_FIT_HOURS: 'publish.hours' };
export const sectionHints: Record<SetupSection, MessageKey> = { profile: 'publish.profile', services: 'publish.services', staff: 'publish.staff', hours: 'publish.hours', policy: 'publish.policy', publish: 'publish.draft' };

export function isSetupSection(value: unknown): value is SetupSection {
  return typeof value === 'string' && (SETUP_SECTIONS as readonly string[]).includes(value);
}

export function sectionComplete(readiness: BusinessReadiness, key: SetupSection) {
  if (key === 'publish') return !!readiness.publishedAt;
  // Staff are assigned per service, so there is nothing to assign until a service exists.
  if (key === 'staff' && readiness.blockers.services) return false;
  return !Object.keys(readiness.blockers).some(field => key === 'staff' ? field.endsWith('.staff') : key === 'hours' ? field === 'hours' || field.endsWith('.hours') : field === key);
}

/** Blockers no setup section can fix, such as approval or the timezone review. */
export function outsideBlockers(readiness: BusinessReadiness) {
  return [...new Set(Object.entries(readiness.blockers).filter(([field]) => !['profile', 'services', 'policy', 'hours'].includes(field) && !field.startsWith('services.')).map(([, code]) => code))];
}

/**
 * Decided 2026-11-01 (decisions.md): an unpublished business that cannot publish yet sees only the setup guide.
 * A business with appointments keeps its agenda, so unpublishing never hides booked customers.
 */
export function needsSetupGuide(readiness: BusinessReadiness) {
  return !readiness.publishedAt && !readiness.ready && !readiness.hasAppointments;
}
