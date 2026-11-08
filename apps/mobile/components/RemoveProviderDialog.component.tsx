import { AppText } from './AppText';
import { ActionButton } from './ActionButton';
import { FormDialog } from './FormDialog';
import type { HomeView } from '../src/types/Home.types';
/** Confirms a removal. It is reversible from the archive, and says so; it never touches existing appointments. */
export function RemoveProviderDialog({ t, name, busy, onConfirm, onClose }: { t: HomeView['t']; name: string | null; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  return <FormDialog testID="remove-provider-dialog" title={t('home.removeTitle', { name: name ?? '' })} open={name !== null} onClose={onClose}>
    <AppText className="leading-6 text-body">{t('home.removeMessage')}</AppText>
    <ActionButton danger label={t('home.removeConfirm')} busy={busy} onPress={onConfirm} />
    <ActionButton secondary label={t('home.removeKeep')} disabled={busy} onPress={onClose} />
  </FormDialog>;
}
