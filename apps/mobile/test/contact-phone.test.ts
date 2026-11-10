import assert from 'node:assert/strict';
import test from 'node:test';
import { contactPhoneEdit } from '../src/lib/ContactPhone';
import { internationalPhone, ISRAEL_COUNTRY_CODE, localPhone } from '../src/lib/PhoneNumber';

const STORED = `+${ISRAEL_COUNTRY_CODE}501234567`;

test('a typed local number is saved in E.164, and the stored number shows as typed', () => {
  assert.deepEqual(contactPhoneEdit('050-1234567', null), { phone: STORED, invalid: false, changed: true });
  assert.equal(localPhone(STORED), '050-1234567');
  assert.equal(localPhone(`+${ISRAEL_COUNTRY_CODE}31234567`), '03-1234567');
  assert.equal(localPhone('+442079460958'), '+442079460958');
  for (const stored of [STORED, `+${ISRAEL_COUNTRY_CODE}31234567`]) assert.equal(internationalPhone(localPhone(stored)), stored);
});

test('the same number written differently is not a change', () => {
  for (const typed of ['0501234567', '050 123 4567', STORED]) assert.equal(contactPhoneEdit(typed, STORED).changed, false, typed);
});

test('an empty field removes the stored number, and is no change when there is none', () => {
  assert.deepEqual(contactPhoneEdit('  ', STORED), { phone: null, invalid: false, changed: true });
  assert.equal(contactPhoneEdit('', null).changed, false);
});

test('something that is not a phone number is refused, never saved', () => {
  assert.deepEqual(contactPhoneEdit('050-12', STORED), { phone: null, invalid: true, changed: false });
});
