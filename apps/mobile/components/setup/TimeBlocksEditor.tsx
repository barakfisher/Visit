import { TimeBlocks } from '../TimeBlocks';
import { useTimeBlocks } from '@/src/lib/TimeBlocks.hook';
import { useSessionStore } from '@/src/state/session';
/** Remounting on a new identity, session context or business drops an open draft from the previous one. */
export function TimeBlocksEditor({ businessId }: { businessId: string }) {
  const identity = useSessionStore(state => state.identityId), version = useSessionStore(state => state.contextVersion);
  return <Blocks key={JSON.stringify([identity, version, businessId])} businessId={businessId} />;
}
function Blocks({ businessId }: { businessId: string }) { return <TimeBlocks {...useTimeBlocks(businessId)} />; }
