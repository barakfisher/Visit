import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { MessageKey } from '../i18n/messages';
import { isApiCode, type TeamMember } from './StaffAccess';
import { teamQueryKey } from './StaffAccess.hook';
import { sameSwitches, withSwitch, type MemberSwitch, type MemberSwitches } from './MemberSwitches';

/**
 * The owner's permissions editor on one member's card (decisions.md, "Switches"). The four switches are sent
 * together, so the server checks the pair "act needs see" in one request; the team listing is reread either way.
 */
export function useMemberSwitches(businessId: string, member: Pick<TeamMember, 'id' | 'switches'>) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MemberSwitches>(member.switches);
  const [message, setMessage] = useState<MessageKey | ''>('');
  const [failed, setFailed] = useState(false);
  const mutation = useMutation({
    mutationFn: (switches: MemberSwitches) => apiRequest<{ switches: MemberSwitches }>(`/v1/provider/businesses/${encodeURIComponent(businessId)}/members/${encodeURIComponent(member.id)}/switches`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(switches) }),
    onSuccess: () => { setFailed(false); setOpen(false); setMessage('switches.saved'); },
    onError: error => { setFailed(true); setMessage(isApiCode(error, 'REAUTH_REQUIRED') ? 'roster.access.reauth' : 'roster.access.failed'); },
    onSettled: () => client.invalidateQueries({ queryKey: teamQueryKey(businessId) }),
  });
  const busy = mutation.isPending;
  return {
    open, draft, message, failed, busy,
    changed: !sameSwitches(draft, member.switches),
    // Each opening starts from what the server holds now.
    start: () => { if (busy) return; setDraft(member.switches); setMessage(''); setFailed(false); setOpen(true); },
    cancel: () => { if (!busy) setOpen(false); },
    toggle: (name: MemberSwitch, on: boolean) => { if (!busy) setDraft(current => withSwitch(current, name, on)); },
    save: () => { if (!busy) mutation.mutate(draft); },
  };
}
export type MemberSwitchesState = ReturnType<typeof useMemberSwitches>;
