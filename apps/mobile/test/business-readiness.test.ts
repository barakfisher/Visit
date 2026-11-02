import assert from 'node:assert/strict';
import test from 'node:test';
import { isSetupSection, needsSetupGuide, outsideBlockers, REQUIRED_SECTIONS, RETURNS_ON_SAVE, sectionComplete, SETUP_SECTIONS, type BusinessReadiness } from '../src/lib/BusinessReadiness';

const blocked: BusinessReadiness = { ready: false, publishedAt: null, hasAppointments: false, blockers: { profile: 'COMPLETE_BUSINESS_PROFILE', services: 'ACTIVE_SERVICE_REQUIRED', policy: 'EXPLICIT_POLICY_REQUIRED', hours: 'WORKING_HOURS_REQUIRED', timezone: 'ISRAEL_TIME_REVIEW_REQUIRED' } };
const ready: BusinessReadiness = { ready: true, publishedAt: null, hasAppointments: false, blockers: {} };

test('an unpublished business that cannot publish and has no appointments sees only the setup guide', () => {
  assert.equal(needsSetupGuide(blocked), true);
  assert.equal(needsSetupGuide(ready), false, 'a ready business reaches the dashboard to publish');
  assert.equal(needsSetupGuide({ ...blocked, publishedAt: '2026-11-01T10:00:00.000Z' }), false, 'a published business keeps its agenda');
  assert.equal(needsSetupGuide({ ...blocked, hasAppointments: true }), false, 'unpublishing never hides booked customers');
});

test('setup steps follow the readiness blockers, with hours before staff and publishing last', () => {
  assert.deepEqual(SETUP_SECTIONS, [...REQUIRED_SECTIONS, 'publish']);
  assert.ok(SETUP_SECTIONS.indexOf('hours') < SETUP_SECTIONS.indexOf('staff'), 'staff hours default to the business hours set before them');
  assert.deepEqual(REQUIRED_SECTIONS.map(key => sectionComplete(blocked, key)), REQUIRED_SECTIONS.map(() => false), 'staff waits for a service');
  assert.deepEqual(REQUIRED_SECTIONS.map(key => sectionComplete(ready, key)), REQUIRED_SECTIONS.map(() => true));
  const perService: BusinessReadiness = { ...ready, ready: false, blockers: { 'services.a.staff': 'ASSIGNED_ACTIVE_STAFF_REQUIRED', 'services.b.hours': 'SERVICE_AND_BUFFERS_MUST_FIT_HOURS' } };
  assert.equal(sectionComplete(perService, 'services'), true);
  assert.equal(sectionComplete(perService, 'staff'), false);
  assert.equal(sectionComplete(perService, 'hours'), false);
  assert.equal(sectionComplete(ready, 'publish'), false); assert.equal(sectionComplete({ ...ready, publishedAt: '2026-11-01T10:00:00.000Z' }, 'publish'), true);
});

test('only single-form sections return to the settings hub on save; services, hours and staff edit in dialogs and stay', () => {
  assert.deepEqual([...RETURNS_ON_SAVE].sort(), ['policy', 'profile']);
});

test('blockers no setup step can fix are reported once; unknown sections are rejected', () => {
  assert.deepEqual(outsideBlockers(blocked), ['ISRAEL_TIME_REVIEW_REQUIRED']);
  assert.deepEqual(outsideBlockers({ ...ready, blockers: { 'services.a.staff': 'ASSIGNED_ACTIVE_STAFF_REQUIRED' } }), []);
  for (const key of SETUP_SECTIONS) assert.equal(isSetupSection(key), true);
  for (const value of ['', 'admin', 'sharing', ['profile'], undefined]) assert.equal(isSetupSection(value), false);
});
