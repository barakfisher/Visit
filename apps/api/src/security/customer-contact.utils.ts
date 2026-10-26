import { AppError } from '../http/errors.js';

type Requirements = { requireCustomerName: boolean; requireVerifiedPhone: boolean; requireVerifiedEmail: boolean };
type Profile = { displayName: string | null; phone: string | null; phoneVerifiedAt: Date | null; email: string | null; emailVerifiedAt: Date | null };
export function customerContactReadiness(policy: Requirements, identity: Profile) {
  const missing = [
    ...(policy.requireCustomerName && (!identity.displayName || identity.displayName.trim().length < 2) ? ['name'] : []),
    ...(policy.requireVerifiedPhone && (!identity.phone || !identity.phoneVerifiedAt) ? ['phone'] : []),
    ...(policy.requireVerifiedEmail && (!identity.email || !identity.emailVerifiedAt) ? ['email'] : []),
  ];
  return { requirements: { requireCustomerName: policy.requireCustomerName, requireVerifiedPhone: policy.requireVerifiedPhone, requireVerifiedEmail: policy.requireVerifiedEmail }, missing, ready: missing.length === 0 };
}
export function assertCustomerContact(policy: Requirements, identity: Profile) {
  if (!customerContactReadiness(policy, identity).ready) throw new AppError(409, 'CUSTOMER_CONTACT_REQUIRED', 'Complete this business’s required verified contact details before booking.');
}
