import { View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { invitableRoles, isApiCode, staffAccess, type InviteRole } from '@/src/lib/StaffAccess';
import { useStaffAccess, useTeam } from '@/src/lib/StaffAccess.hook';
import type { RosterStaff } from '@/src/lib/StaffRoster';
import { ActionButton } from './ActionButton';
import { AppText } from './AppText';
import { Control } from './Control';
import { outlineActionClass } from './AddButton';
import { TextField } from './TextField';
import { MemberSwitchesEditor, useMemberLabel } from './MemberSwitches.component';

const badgeClass = 'self-start rounded-full px-3 py-1 text-sm font-semibold';

/** A staff card's app access: its badge, "Invite to app", and "Remove app access" (worker-access.md, Owner flow). */
export function StaffAccessSection({ businessId, row, copy }: { businessId: string; row: RosterStaff; copy: (text: string) => Promise<boolean> }) {
  const { t } = useAppLocale();
  const team = useTeam(businessId);
  const state = useStaffAccess(businessId, row.id, copy);
  const memberName = useMemberLabel();
  // Without the team permission there is nothing to show or do here.
  if (team.isLoading) return null;
  // A 403 means this member has no team permission: nothing to show, not an error.
  if (team.isError && isApiCode(team.error, 'FORBIDDEN')) return null;
  if (team.isError || !team.data) return <AppText testID={`staff-access-failed-${row.id}`} className="text-sm text-muted">{t('roster.access.loadFailed')}</AppText>;
  const roles = invitableRoles(team.data);
  if (!roles.length) return null;
  const access = staffAccess(team.data, row.id);
  // An invitation names a preset; an active member's label comes from their switches (decisions.md, "Switches").
  const roleName = (role: string) => t(role === 'MANAGER' ? 'roster.access.manager' : 'roster.access.worker');
  const manageable = access.kind === 'active' ? access.member.removable : access.kind === 'pending' && (roles as string[]).includes(access.role);
  return <View testID={`staff-access-${row.id}`} className="gap-3">
    {access.kind === 'active' ? <AppText testID={`staff-access-badge-${row.id}`} className={`${badgeClass} bg-brand-soft text-brand`}>{t('roster.access.active', { account: access.account, role: memberName(access.member.role, access.member.switches) })}</AppText>
      : access.kind === 'pending' ? <AppText testID={`staff-access-badge-${row.id}`} className={`${badgeClass} bg-canvas text-warning`}>{t('roster.access.pending', { recipient: access.recipientHint })}</AppText>
      : <AppText testID={`staff-access-badge-${row.id}`} className={`${badgeClass} bg-canvas text-muted`}>{t('roster.access.none')}</AppText>}

    {access.kind === 'active' && !state.inviting && !state.confirmRemove ? <MemberSwitchesEditor businessId={businessId} member={access.member} name={row.displayName} testID={`staff-switches-${row.id}`} /> : null}
    {state.inviting ? <InviteForm name={row.displayName} roles={roles} roleName={roleName} state={state} />
      : access.kind === 'active' ? (manageable ? state.confirmRemove ? <View className="gap-3 rounded-control border border-line bg-canvas p-3">
        <AppText>{t('roster.access.removeHelp', { name: row.displayName })}</AppText>
        <View className="flex-row gap-3">
          <View className="flex-1"><ActionButton danger busy={state.busy} label={t('roster.access.confirmRemove')} onPress={() => state.removeAccess(access.membershipId)} /></View>
          <View className="flex-1"><ActionButton secondary disabled={state.busy} label={t('roster.cancel')} onPress={() => state.askRemove(false)} /></View>
        </View>
      </View> : <ActionLink testID={`staff-remove-access-${row.id}`} label={t('roster.access.remove')} accessibilityLabel={t('roster.access.removeLabel', { name: row.displayName })} disabled={state.busy} onPress={() => state.askRemove(true)} /> : null)
      : <View className="flex-row flex-wrap gap-2">
        {/* A manager sees the badge and may cancel what they could revoke, but links no calendar. */}
        {!team.data.canLinkCalendars ? <AppText testID={`staff-owner-links-${row.id}`} className="text-sm text-muted">{t('roster.ownerLinksCalendars')}</AppText>
          : access.kind === 'pending' && !manageable ? null : <ActionLink testID={`staff-invite-${row.id}`} label={t(access.kind === 'pending' ? 'roster.access.newLink' : 'roster.access.invite')} accessibilityLabel={t(access.kind === 'pending' ? 'roster.access.newLinkLabel' : 'roster.access.inviteLabel', { name: row.displayName })} disabled={state.busy} onPress={state.openInvite} />}
        {access.kind === 'pending' && manageable ? <ActionLink testID={`staff-revoke-invite-${row.id}`} label={t('roster.access.revoke')} disabled={state.busy} onPress={() => state.revokeInvitation(access.invitationId)} /> : null}
      </View>}
    {state.message ? <AppText role={state.failed ? 'alert' : 'status'} className={state.failed ? 'text-danger' : 'text-ink'}>{t(state.message)}</AppText> : null}
  </View>;
}

function ActionLink({ label, accessibilityLabel, onPress, disabled, testID }: { label: string; accessibilityLabel?: string; onPress: () => void; disabled: boolean; testID: string }) {
  return <Control testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} className={outlineActionClass(disabled)}>
    <AppText className={`font-semibold ${disabled ? 'text-muted' : 'text-brand'}`}>{label}</AppText>
  </Control>;
}

function InviteForm({ name, roles, roleName, state }: { name: string; roles: InviteRole[]; roleName: (role: string) => string; state: ReturnType<typeof useStaffAccess> }) {
  const { t } = useAppLocale();
  return <View testID="staff-invite-form" className="gap-3 rounded-control border border-line bg-canvas p-3">
    <AppText accessibilityRole="header" className="font-semibold text-ink">{t('roster.access.inviteTitle', { name })}</AppText>
    {state.link ? <>
      <AppText>{t('roster.access.once')}</AppText>
      <AppText testID="staff-invite-link" selectable style={{ writingDirection: 'ltr', textAlign: 'left' }} className="rounded-control border border-line bg-surface p-2 text-sm text-ink">{state.link}</AppText>
      <View className="flex-row gap-3">
        <View className="flex-1"><ActionButton label={t('roster.access.copy')} onPress={() => void state.copyLink()} /></View>
        <View className="flex-1"><ActionButton secondary label={t('roster.access.done')} onPress={state.closeInvite} /></View>
      </View>
    </> : <>
      {roles.length > 1 ? <View accessibilityRole="radiogroup" accessibilityLabel={t('roster.access.role')} className="gap-2">
        <AppText className="text-body">{t('roster.access.role')}</AppText>
        <View className="flex-row gap-2">{roles.map(role => <Choice key={role} testID={`staff-invite-role-${role}`} selected={state.role === role} label={roleName(role)} disabled={state.busy} onPress={() => state.setRole(role)} />)}</View>
        <AppText className="text-sm text-muted">{t(state.role === 'MANAGER' ? 'roster.access.managerHint' : 'roster.access.workerHint')}</AppText>
      </View> : null}
      <View accessibilityRole="radiogroup" accessibilityLabel={t('roster.access.channel')} className="flex-row gap-2">
        {(['email', 'phone'] as const).map(channel => <Choice key={channel} testID={`staff-invite-channel-${channel}`} selected={state.channel === channel} label={t(channel === 'email' ? 'roster.access.email' : 'roster.access.phone')} disabled={state.busy} onPress={() => state.chooseChannel(channel)} />)}
      </View>
      <TextField identifier label={t(state.channel === 'email' ? 'roster.access.emailLabel' : 'roster.access.phoneLabel')} hint={t('roster.access.recipientHint')} value={state.recipient} onChangeText={state.setRecipient} autoCapitalize="none" keyboardType={state.channel === 'email' ? 'email-address' : 'phone-pad'} editable={!state.busy} maxLength={254} testID="staff-invite-recipient" />
      <View className="flex-row gap-3">
        <View className="flex-1"><ActionButton busy={state.busy} disabled={!state.canSend} label={t('roster.access.create')} onPress={state.send} /></View>
        <View className="flex-1"><ActionButton secondary disabled={state.busy} label={t('roster.cancel')} onPress={state.closeInvite} /></View>
      </View>
    </>}
  </View>;
}

function Choice({ label, selected, disabled, onPress, testID }: { label: string; selected: boolean; disabled: boolean; onPress: () => void; testID: string }) {
  return <Control testID={testID} accessibilityRole="radio" aria-checked={selected} accessibilityState={{ checked: selected, disabled }} disabled={disabled} onPress={onPress}
    className={`min-h-touch flex-1 items-center justify-center rounded-control border px-4 py-2 ${selected ? 'border-brand bg-brand-soft' : 'border-line bg-surface'}`}>
    <AppText className={selected ? 'font-semibold text-brand' : 'text-ink'}>{label}</AppText>
  </Control>;
}
