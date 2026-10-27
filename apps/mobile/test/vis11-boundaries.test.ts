import assert from 'node:assert/strict';
import test from 'node:test';
import { availableBookingSlots, bookingMonthCells, bookingSlotId } from '../src/lib/CompactBooking.utils';
import { menuCapabilities, type AccountNavigation } from '../src/lib/navigation';
import { slotLabels } from '../src/lib/slotLabels';
import { defaultLocale, directionFor, translate } from '../src/i18n/messages';
import type { Slot } from '../src/types/flows';

const account = (memberships: AccountNavigation['memberships'], providerApplications: AccountNavigation['providerApplications'] = []): AccountNavigation => ({ identity: { platformRole: 'CUSTOMER' }, memberships, providerApplications });
const member = (role: string, status: string, approvalStatus: string): AccountNavigation['memberships'][number] => ({ role, status, business: { id: 'tenant', name: 'Tenant', approvalStatus } });

test('VIS-11 menu capability matrix denies every unsupported membership boundary', () => {
  for (const role of ['OWNER', 'MANAGER', 'STAFF', 'CUSTOMER', '', 'owner']) {
    for (const status of ['ACTIVE', 'PENDING', 'SUSPENDED', 'REVOKED', '']) {
      for (const approval of ['APPROVED', 'PENDING', 'REJECTED', '']) {
        const result = menuCapabilities(account([member(role, status, approval)]));
        const permitted = ['OWNER', 'MANAGER'].includes(role) && status === 'ACTIVE' && approval === 'APPROVED';
        assert.equal(result.managed.length, permitted ? 1 : 0, `${role}/${status}/${approval}`);
        assert.equal(result.becomeProvider, !permitted);
      }
    }
  }
  assert.deepEqual(menuCapabilities(undefined), { managed: [], applicationStatus: false, becomeProvider: false });
});

test('VIS-11 completed applications do not masquerade as pending and input is unchanged', () => {
  for (const status of ['APPROVED', 'WITHDRAWN', '']) {
    const input = account([], [{ id: 'application', status, business: { name: 'Business' } }]);
    const before = structuredClone(input);
    assert.deepEqual(menuCapabilities(input), { managed: [], applicationStatus: false, becomeProvider: true });
    assert.deepEqual(input, before);
  }
  for (const status of ['PENDING', 'REJECTED']) {
    const result = menuCapabilities(account([], [{ id: 'application', status, business: { name: 'Business' } }]));
    assert.equal(result.applicationStatus, true);
    assert.equal(result.becomeProvider, false);
  }
});

test('VIS-11 fold instants remain separately selectable after exact conflict removal', () => {
  const first: Slot = { staffId: 'staff', staffName: 'Specialist', startsAt: '2026-10-24T22:30:00Z', localTime: '01:30', utcOffset: '+03:00', available: true, locked: false };
  const second: Slot = { ...first, startsAt: '2026-10-24T23:30:00Z', utcOffset: '+02:00' };
  const input = Object.freeze([Object.freeze(second), Object.freeze(first)]);
  assert.notEqual(bookingSlotId(first), bookingSlotId(second));
  assert.deepEqual(availableBookingSlots(input, null), [first, second]);
  assert.deepEqual(availableBookingSlots(input, bookingSlotId(first)), [second]);
  assert.deepEqual(availableBookingSlots(input, bookingSlotId(second)), [first]);
  assert.deepEqual(input, [second, first]);
  assert.deepEqual(slotLabels(input, 'he'), ['01:30 (מופע שני) · Specialist', '01:30 (מופע ראשון) · Specialist']);
});

test('VIS-11 labels handle empty fixtures and duplicate offsets without false DST occurrences', () => {
  assert.deepEqual(slotLabels([]), []);
  const slot = { staffId: 'staff', staffName: 'שם ארוך מאוד של מומחה', localTime: '01:30', utcOffset: '+02:00' };
  assert.deepEqual(slotLabels([slot, slot], 'he'), [`01:30 · ${slot.staffName}`, `01:30 · ${slot.staffName}`]);
});

test('VIS-11 spring and autumn calendar availability uses server local dates across device zones', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      for (const date of ['2026-03-27', '2026-10-25']) {
        for (const language of ['he-IL', 'en-US']) {
          const cells = bookingMonthCells(date.slice(0, 7), [date], date, language);
          assert.deepEqual(cells.filter(cell => cell?.available).map(cell => cell?.date), [date]);
          assert.deepEqual(cells.filter(cell => cell?.selected).map(cell => cell?.date), [date]);
        }
      }
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('VIS-11 application default is Hebrew RTL while English explicitly selects LTR', () => {
  assert.equal(defaultLocale, 'he');
  assert.equal(directionFor(defaultLocale), 'rtl');
  assert.equal(translate(defaultLocale, 'nav.open'), 'פתיחת תפריט');
  assert.equal(directionFor('en'), 'ltr');
  assert.equal(translate('en', 'nav.open'), 'Open menu');
});
