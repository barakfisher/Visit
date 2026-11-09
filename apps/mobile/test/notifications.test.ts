import assert from 'node:assert/strict';
import test from 'node:test';
import { translate } from '../src/i18n/messages';
import { badgeText, bellLabel, circleText, rowsToMark, isNotificationQuery, MAX_BADGE_COUNT, notificationListKey, notificationRow, notificationTarget, unreadKey } from '../src/lib/Notifications.utils';
import type { InboxNotification } from '../src/types/Notifications.types';

const business = { id: 'business-1', name: 'Dana Studio', timezone: 'Asia/Jerusalem' };
// 23:30 UTC is already the next day in Israel: the agenda has to open on the business's day.
const booking = { id: 'booking-1', startsAt: '2026-11-19T23:30:00.000Z', endsAt: '2026-11-20T00:00:00.000Z', previousStartsAt: null, serviceName: 'Haircut', customerName: 'Noa' };
const item = (patch: Partial<InboxNotification>): InboxNotification => ({ id: 'n', kind: 'BOOKING_CANCELLED', audience: 'BUSINESS', createdAt: '2026-11-09T08:00:00.000Z', read: false, business, booking, ...patch });

test('each notification opens where it belongs', () => {
  assert.deepEqual(notificationTarget(item({ audience: 'CUSTOMER' })), { to: 'appointment', bookingId: booking.id });
  assert.deepEqual(notificationTarget(item({})), { to: 'business', businessId: business.id, date: '2026-11-20' });
  assert.deepEqual(notificationTarget(item({ kind: 'BUSINESS_APPROVED', booking: null })), { to: 'business', businessId: business.id });
  assert.deepEqual(notificationTarget(item({ kind: 'BUSINESS_REJECTED', audience: 'CUSTOMER', booking: null })), { to: 'application' });
});

test('the row is worded in the language it is read in, and names the business', () => {
  for (const locale of ['he', 'en'] as const) {
    const row = notificationRow(item({}), locale, true);
    assert.equal(row.title, translate(locale, 'notifications.kind.BOOKING_CANCELLED'));
    assert.equal(row.businessName, business.name);
    assert.ok(row.lines.includes('Noa'));
    assert.ok(row.isNew);
    assert.equal(row.action, null);
  }
});

test('a move says where the appointment was; an approval offers to continue setup', () => {
  const moved = notificationRow(item({ kind: 'BOOKING_RESCHEDULED', booking: { ...booking, previousStartsAt: '2026-11-18T08:00:00.000Z' } }), 'en', false);
  assert.ok(moved.lines.some(line => line.startsWith(translate('en', 'notifications.previous', { when: '' }))));
  const previous = translate('en', 'notifications.previous', { when: '' });
  const cancelled = notificationRow(item({ booking: { ...booking, previousStartsAt: booking.startsAt } }), 'en', false);
  assert.ok(!cancelled.lines.some(line => line.startsWith(previous)));
  const sameTime = notificationRow(item({ kind: 'BOOKING_RESCHEDULED', booking: { ...booking, previousStartsAt: booking.startsAt } }), 'en', false);
  assert.ok(!sameTime.lines.some(line => line.startsWith(previous)));
  const approved = notificationRow(item({ kind: 'BUSINESS_APPROVED', booking: null }), 'he', false);
  assert.equal(approved.action, translate('he', 'notifications.approved.action'));
  assert.deepEqual(approved.lines, [translate('he', 'notifications.approved.body')]);
});

test('the circle counts up to its limit, and the bell says the count aloud', () => {
  assert.equal(badgeText(MAX_BADGE_COUNT), String(MAX_BADGE_COUNT));
  assert.equal(badgeText(MAX_BADGE_COUNT + 1), `${MAX_BADGE_COUNT}+`);
  assert.equal(bellLabel('en', 0), translate('en', 'notifications.bell'));
  assert.equal(bellLabel('he', 1), translate('he', 'notifications.bell.one', { count: 1 }));
  assert.equal(bellLabel('en', MAX_BADGE_COUNT + 1), translate('en', 'notifications.bell.other', { count: `${MAX_BADGE_COUNT}+` }));
  assert.equal(bellLabel('he', 2), translate('he', 'notifications.bell.two', { count: 2 }));
  assert.equal(bellLabel('en', 5), translate('en', 'notifications.bell.other', { count: 5 }));
});

test('a failed count shows no circle, whatever the cache still holds', () => {
  assert.equal(circleText(3, false), '3');
  assert.equal(circleText(3, true), null);
  assert.equal(circleText(0, false), null);
  assert.equal(circleText(undefined, false), null);
});

test('marking: the first read always marks, later reads only for something new', () => {
  const read = item({ id: 'a', read: true }), unread = item({ id: 'b', read: false });
  assert.equal(rowsToMark([], new Set(), false), null);
  // Everything shown is read, but unread rows may sit below the list's limit.
  assert.deepEqual(rowsToMark([read], new Set(), false), ['a']);
  assert.equal(rowsToMark([read], new Set(), true), null);
  assert.deepEqual(rowsToMark([unread, read], new Set(), true), ['b', 'a']);
  assert.equal(rowsToMark([unread, read], new Set(['b']), true), null, 'already sent, even if it failed: the next opening retries');
});

test('the keys of notification reads match the live signal, and they are keyed to the person', () => {
  assert.ok(isNotificationQuery(unreadKey('a'))); assert.ok(isNotificationQuery(notificationListKey('a')));
  assert.ok(!isNotificationQuery(['me', 'a']));
  assert.notDeepEqual(unreadKey('a'), unreadKey('b'));
});
