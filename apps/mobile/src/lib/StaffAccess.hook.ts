import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api';
import type { MessageKey } from '../i18n/messages';
import { isApiCode, STAFF_ALREADY_LINKED, validRecipient, type InviteChannel, type InviteRole, type Team } from './StaffAccess';

type Action = { kind: 'invite' } | { kind: 'revokeInvitation'; id: string } | { kind: 'removeAccess'; membershipId: string };

/** The team listing every staff card reads its badge from; the Team access screen shares this key. */
export const teamQueryKey = (businessId: string) => ['provider', businessId, 'team'] as const;
export function useTeam(businessId: string) {
  return useQuery({ queryKey: teamQueryKey(businessId), queryFn: () => apiRequest<Team>(`/v1/provider/businesses/${encodeURIComponent(businessId)}/team`), retry: false });
}

/**
 * One staff card's app access: invite to the app (reusing the private-link invitation), revoke a pending
 * link, or remove app access. `copy` is the screen's clipboard, which Storybook cannot bundle.
 */
export function useStaffAccess(businessId: string, staffId: string, copy: (text: string) => Promise<boolean>) {
  const client = useQueryClient();
  const base = `/v1/provider/businesses/${encodeURIComponent(businessId)}`;
  const [inviting, setInviting] = useState(false);
  const [role, setRole] = useState<InviteRole>('STAFF');
  const [channel, setChannel] = useState<InviteChannel>('email');
  const [recipient, setRecipient] = useState('');
  const [link, setLink] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [message, setMessage] = useState<MessageKey | ''>('');
  const [failed, setFailed] = useState(false);
  // The raw link lives only here, in memory, and is cleared when the form closes.
  const copying = useRef(false);
  const mutation = useMutation({
    // The response carries the raw link; it must not outlive this card's state in the mutation cache.
    gcTime: 0,
    mutationFn: (action: Action) => action.kind === 'invite'
      ? apiRequest<{ url: string }>(`${base}/invitations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role, channel, recipient: recipient.trim(), staffId }) })
      : apiRequest(action.kind === 'revokeInvitation' ? `${base}/invitations/${encodeURIComponent(action.id)}` : `${base}/members/${encodeURIComponent(action.membershipId)}`, { method: 'DELETE' }),
    onSuccess: (result, action) => {
      setFailed(false);
      if (action.kind === 'invite') { setLink((result as { url: string }).url); setRecipient(''); setMessage(''); }
      else if (action.kind === 'revokeInvitation') { setMessage('roster.access.revoked'); }
      else { setConfirmRemove(false); setMessage('roster.access.removed'); }
    },
    onError: error => { setFailed(true); setMessage(isApiCode(error, 'REAUTH_REQUIRED') ? 'roster.access.reauth' : isApiCode(error, STAFF_ALREADY_LINKED) ? 'roster.access.alreadyLinked' : 'roster.access.failed'); },
    // Success or failure, the badge must show what the server now holds.
    onSettled: () => client.invalidateQueries({ queryKey: teamQueryKey(businessId) }),
  });
  const busy = mutation.isPending;
  function openInvite() { if (busy) return; setInviting(true); setLink(''); setRecipient(''); setRole('STAFF'); setChannel('email'); setMessage(''); setFailed(false); setConfirmRemove(false); }
  function closeInvite() { if (busy) return; setInviting(false); setLink(''); setRecipient(''); }
  function chooseChannel(next: InviteChannel) { setChannel(next); setRecipient(''); }
  async function copyLink() {
    if (copying.current || !link) return;
    copying.current = true;
    try { const ok = await copy(link); setFailed(!ok); setMessage(ok ? 'roster.access.copied' : 'roster.access.failed'); }
    catch { setFailed(true); setMessage('roster.access.failed'); }
    finally { copying.current = false; }
  }
  return {
    inviting, role, channel, recipient, link, confirmRemove, message, failed, busy,
    canSend: validRecipient(channel, recipient) && !busy,
    openInvite, closeInvite, setRole, chooseChannel, setRecipient, copyLink,
    send: () => { if (validRecipient(channel, recipient)) mutation.mutate({ kind: 'invite' }); },
    revokeInvitation: (id: string) => mutation.mutate({ kind: 'revokeInvitation', id }),
    askRemove: (open: boolean) => { if (!busy) { setConfirmRemove(open); setMessage(''); } },
    removeAccess: (membershipId: string) => mutation.mutate({ kind: 'removeAccess', membershipId }),
  };
}
export type StaffAccessState = ReturnType<typeof useStaffAccess>;
