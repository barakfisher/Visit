import { translate, type Locale } from './messages';

// The cancel confirmation always speaks the customer's language; there is no built-in fallback copy.
export function appointmentCancellationCopy(locale: Locale) {
  return { title: translate(locale, 'upcoming.cancelTitle'), message: translate(locale, 'upcoming.cancelMessage'), keep: translate(locale, 'upcoming.keep'), cancel: translate(locale, 'details.cancel') };
}
