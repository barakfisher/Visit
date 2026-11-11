import { AppText } from './AppText';

/**
 * The "*" after a required field's label. Screen readers skip it: the field itself says it is required
 * (`aria-required` on web), and a spoken "star" would only get in the way.
 */
export function RequiredMark() {
  return <AppText accessible={false} importantForAccessibility="no" aria-hidden className="text-danger"> *</AppText>;
}
