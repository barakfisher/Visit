import assert from 'node:assert/strict';
import test from 'node:test';
import { MIN_RECIPIENT, invitableRoles, staffAccess, validRecipient, type Team, type TeamInvitation, type TeamMember } from '../src/lib/StaffAccess';
import { NO_SWITCHES } from '../src/lib/MemberSwitches';

const now = new Date('2026-11-18T10:00:00Z'), later = '2026-11-19T10:00:00.000Z', earlier = '2026-11-17T10:00:00.000Z';
const invitation = (patch: Partial<TeamInvitation>): TeamInvitation => ({ id: 'i', role: 'STAFF', recipientHint: '***4567', createdAt: earlier, expiresAt: later, acceptedAt: null, revokedAt: null, staff: { id: 'noa', displayName: 'Noa' }, ...patch });
const team = (patch: Partial<Team>): Team => ({ role: 'OWNER', switches: NO_SWITCHES, invitablePresets: ['STAFF', 'MANAGER'], members: [], invitations: [], ...patch });

test('a calendar linked to an active member is Active, under their name or masked contact', () => {
  const member: TeamMember = { id: 'm', identityId: 'p', role: 'MEMBER', switches: NO_SWITCHES, editable: true, removable: true, label: 'n***@x.test', name: null, staff: { id: 'noa', displayName: 'Noa', membershipId: 'm' } };
  const linked = team({ members: [member] });
  assert.deepEqual(staffAccess(linked, 'noa', now), { kind: 'active', membershipId: 'm', account: 'n***@x.test', member });
  assert.deepEqual(staffAccess(linked, 'dan', now), { kind: 'none' });
});

test('only a live invitation for this calendar is Pending; expired, revoked, accepted and other rows are not', () => {
  assert.equal(staffAccess(team({ invitations: [invitation({})] }), 'noa', now).kind, 'pending');
  for (const patch of [{ expiresAt: earlier }, { revokedAt: earlier }, { acceptedAt: earlier }, { staff: { id: 'dan', displayName: 'Dan' } }, { staff: null }]) {
    assert.equal(staffAccess(team({ invitations: [invitation(patch)] }), 'noa', now).kind, 'none', JSON.stringify(patch));
  }
});

test('the presets offered are the ones the server says this viewer may invite with', () => {
  assert.deepEqual(invitableRoles(team({})), ['STAFF', 'MANAGER']);
  assert.deepEqual(invitableRoles(team({ invitablePresets: ['STAFF'] })), ['STAFF']);
  assert.deepEqual(invitableRoles(team({ invitablePresets: [] })), []);
});

test('recipients match what the server accepts', () => {
  assert.equal(validRecipient('email', ' dana@b.co '), true);
  assert.equal(validRecipient('email', 'a@b.co'), 'a@b.co'.length >= MIN_RECIPIENT, 'shorter than the server minimum');
  assert.equal(validRecipient('email', 'a@b'), false);
  assert.equal(validRecipient('phone', '+972501234567'), true);
  assert.equal(validRecipient('phone', '0501234567'), false);
});
