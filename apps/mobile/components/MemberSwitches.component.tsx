import { Switch, View } from 'react-native';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import type { MessageKey } from '@/src/i18n/messages';
import { MEMBER_SWITCHES, memberLabel, type MemberSwitch, type MemberSwitches, type MembershipRole } from '@/src/lib/MemberSwitches';
import { useMemberSwitches } from '@/src/lib/MemberSwitches.hook';
import type { TeamMember } from '@/src/lib/StaffAccess';
import { ActionButton } from './ActionButton';
import { AppText } from './AppText';
import { Control } from './Control';
import { outlineActionClass } from './AddButton';

const titles: Record<MemberSwitch, MessageKey> = { seeAllCalendars: 'switches.seeAllCalendars', actOnAllCalendars: 'switches.actOnAllCalendars', businessSetup: 'switches.businessSetup', manageTeam: 'switches.manageTeam' };
const hints: Record<MemberSwitch, MessageKey> = { seeAllCalendars: 'switches.seeAllCalendarsHint', actOnAllCalendars: 'switches.actOnAllCalendarsHint', businessSetup: 'switches.businessSetupHint', manageTeam: 'switches.manageTeamHint' };
const shorts: Record<MemberSwitch, MessageKey> = { seeAllCalendars: 'switches.short.seeAllCalendars', actOnAllCalendars: 'switches.short.actOnAllCalendars', businessSetup: 'switches.short.businessSetup', manageTeam: 'switches.short.manageTeam' };

/** The card label from the switches: Owner, Manager when all four are on, otherwise Worker plus its extra permissions. */
export function useMemberLabel() {
  const { t } = useAppLocale();
  return (role: MembershipRole, switches: MemberSwitches) => {
    const label = memberLabel(role, switches);
    if (label.kind === 'owner') return t('roster.access.owner');
    if (label.kind === 'manager') return t('roster.access.manager');
    return label.extras.length ? t('switches.workerWith', { extras: label.extras.map(name => t(shorts[name])).join(t('switches.separator')) }) : t('roster.access.worker');
  };
}

/**
 * The owner's "Permissions" on a member's card (Roster or Team access). Shown only where the server says this viewer
 * may edit this member, which is the owner, never on their own card.
 */
export function MemberSwitchesEditor({ businessId, member, name, testID }: { businessId: string; member: TeamMember; name: string; testID: string }) {
  const { t } = useAppLocale();
  const state = useMemberSwitches(businessId, member);
  if (!member.editable) return null;
  const message = state.message ? <AppText role={state.failed ? 'alert' : 'status'} className={state.failed ? 'text-danger' : 'text-success'}>{t(state.message)}</AppText> : null;
  if (!state.open) return <View className="gap-2">
    <Control testID={`${testID}-open`} accessibilityRole="button" accessibilityLabel={t('switches.editLabel', { name })} disabled={state.busy} onPress={state.start} className={outlineActionClass(state.busy)}>
      <AppText className="font-semibold text-brand">{t('switches.edit')}</AppText>
    </Control>
    {message}
  </View>;
  // Without a calendar a member opens the business only with "see" (decisions.md, "Switches").
  const opensNothing = !member.staff && !state.draft.seeAllCalendars && MEMBER_SWITCHES.some(key => state.draft[key]);
  return <View testID={testID} className="gap-3 rounded-control border border-line bg-canvas p-3">
    <AppText accessibilityRole="header" className="font-semibold text-ink">{t('switches.title', { name })}</AppText>
    <AppText className="text-sm text-body">{t('switches.always')}</AppText>
    {MEMBER_SWITCHES.map(key => <View key={key} className="gap-1">
      <View className="flex-row items-center justify-between gap-3">
        <AppText className="flex-1 font-medium text-ink">{t(titles[key])}</AppText>
        <Switch testID={`${testID}-${key}`} accessibilityLabel={t(titles[key])} disabled={state.busy} value={state.draft[key]} onValueChange={on => state.toggle(key, on)} />
      </View>
      <AppText className="text-sm text-body">{t(hints[key])}</AppText>
    </View>)}
    {opensNothing ? <AppText testID={`${testID}-no-workspace`} className="text-sm text-warning">{t('switches.noWorkspace')}</AppText> : null}
    <View className="flex-row gap-3">
      <View className="flex-1"><ActionButton testID={`${testID}-save`} busy={state.busy} disabled={!state.changed} label={t('switches.save')} onPress={state.save} /></View>
      <View className="flex-1"><ActionButton secondary disabled={state.busy} label={t('roster.cancel')} onPress={state.cancel} /></View>
    </View>
    {message}
  </View>;
}
