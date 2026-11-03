import assert from 'node:assert/strict';
import test from 'node:test';
import { E164_PATTERN, internationalBusinessPhone, ISRAEL_COUNTRY_CODE } from '../src/lib/BusinessPhone';
import { BUSINESS_SLUG_MAX_LENGTH, businessSlugInput, businessSlugPath, isBusinessSlug } from '../src/lib/BusinessSlug';
import { businessListingLine } from '../src/lib/BusinessListing';
import { translate } from '../src/i18n/messages';

test('Israeli local numbers, typed as people write them, become the international number the API stores', () => {
  const mobile = `+${ISRAEL_COUNTRY_CODE}501234567`;
  for (const typed of ['050-1234567', '0501234567', '050 123 4567', ' (050) 123-4567 ', '050.123.4567']) assert.equal(internationalBusinessPhone(typed), mobile, typed);
  assert.equal(internationalBusinessPhone('03-1234567'), `+${ISRAEL_COUNTRY_CODE}31234567`);
  assert.equal(internationalBusinessPhone('+972501234567'), mobile);
  assert.equal(internationalBusinessPhone('+44 20 7946 0958'), '+442079460958');
  for (const typed of ['050-1234567', '03-1234567', '+44 20 7946 0958']) assert.match(internationalBusinessPhone(typed)!, E164_PATTERN);
});

test('anything that is not a phone number is refused rather than guessed', () => {
  for (const typed of ['', '12345', '050-12345', '050-12345678', '00501234567', '972501234567', '+0501234567', 'phone', '050-123456a']) assert.equal(internationalBusinessPhone(typed), null, typed);
});

test('the business URL name folds capitals but refuses Hebrew, spaces and loose hyphens', () => {
  assert.equal(businessSlugInput('Roni-Cuts'), 'roni-cuts');
  for (const slug of ['roni', 'roni-cuts', 'studio-2']) assert.equal(isBusinessSlug(slug), true, slug);
  for (const slug of ['', 'רוני', 'roni cuts', '-roni', 'roni-', 'roni--cuts', 'roni_cuts', 'a'.repeat(BUSINESS_SLUG_MAX_LENGTH + 1)]) assert.equal(isBusinessSlug(slug), false, slug);
  assert.equal(businessSlugPath('roni-cuts'), '/p/roni-cuts');
});

test('the Hebrew copy keeps Latin examples in left-to-right isolates so "+" and hyphens stay in place', () => {
  for (const key of ['setup.invalidPhone', 'setup.phoneHint', 'account.slugHint'] as const) assert.match(translate('he', key), /⁦[^⁩]+⁩/, key);
});

test('a business card leaves out what the owner has not filled in, with no dangling separator', () => {
  assert.equal(businessListingLine('Jerusalem', 'Wellness'), 'Jerusalem · Wellness');
  assert.equal(businessListingLine('Jerusalem', null), 'Jerusalem');
  assert.equal(businessListingLine(null, 'Wellness'), 'Wellness');
  assert.equal(businessListingLine(' ', undefined), '');
});
