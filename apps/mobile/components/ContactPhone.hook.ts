import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/src/lib/api';
import { CONTACT_PHONE_ENDPOINT, contactPhoneEdit } from '@/src/lib/ContactPhone';
import { localPhone } from '@/src/lib/PhoneNumber';
import { useAppLocale } from '@/src/i18n/LocaleContext';
import { useSessionStore } from '@/src/state/session';

type Status = 'idle' | 'saving' | 'saved' | 'failed';

/** Edits the profile's unverified contact phone. `saved` is the stored E.164 number from /v1/me. */
export function useContactPhone({ saved }: { saved: string | null }) {
  const { t } = useAppLocale();
  const queryClient = useQueryClient();
  const identityId = useSessionStore(state => state.identityId);
  const [draft, setDraftValue] = useState(saved ? localPhone(saved) : '');
  const [status, setStatus] = useState<Status>('idle');
  const [showInvalid, setShowInvalid] = useState(false);
  // A save, or another device, changes the stored number: show it as stored. Adjusted while rendering, not in an effect.
  const [shown, setShown] = useState(saved);
  if (shown !== saved) { setShown(saved); setDraftValue(saved ? localPhone(saved) : ''); }
  const edit = contactPhoneEdit(draft, saved);
  function setDraft(value: string) { setDraftValue(value); setShowInvalid(false); if (status !== 'saving') setStatus('idle'); }
  async function save() {
    if (edit.invalid) { setShowInvalid(true); return; }
    if (!edit.changed) return;
    setStatus('saving');
    try {
      await apiRequest(CONTACT_PHONE_ENDPOINT, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contactPhone: edit.phone }) });
      // Only the account read: the appointment queries under 'me' do not hold the phone.
      await queryClient.invalidateQueries({ queryKey: ['me', identityId], exact: true });
      setStatus('saved');
    } catch { setStatus('failed'); }
  }
  return { t, draft, setDraft, save, status, invalid: showInvalid && edit.invalid, canSave: edit.changed || edit.invalid, removing: edit.changed && edit.phone === null };
}
