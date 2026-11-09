import { agendaTopic, customerTopic, followLiveSignal } from '../../src/infra/live-signals.js';

const SIGNAL_WAIT_MS = 3000, QUIET_WAIT_MS = 500;

/** Runs the action and fails unless it signals this business's agenda. */
export const expectAgendaSignal = <T>(businessId: string, action: () => Promise<T>) => expectSignal(agendaTopic(businessId), action);
/** Runs the action and fails unless it signals this customer's appointments. */
export const expectCustomerSignal = <T>(identityId: string, action: () => Promise<T>) => expectSignal(customerTopic(identityId), action);

/** Runs the action, which may fail, and fails unless this business's agenda stays quiet. */
export async function expectNoAgendaSignal(businessId: string, action: () => Promise<unknown>) {
  const topic = agendaTopic(businessId);
  let signals = 0;
  const stop = await followLiveSignal(topic, () => { signals += 1; }, () => {});
  try {
    await action().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, QUIET_WAIT_MS));
    if (signals) throw new Error(`${topic} was signalled.`);
  } finally { stop(); }
}

async function expectSignal<T>(topic: string, action: () => Promise<T>): Promise<T> {
  let heard: () => void = () => {};
  const signal = new Promise<void>(resolve => { heard = resolve; });
  const stop = await followLiveSignal(topic, () => heard(), () => {});
  try {
    const result = await action();
    // Timed from here: a slow action has not missed anything, and no rejection can fire before anyone waits for it.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${topic} was not signalled.`)), SIGNAL_WAIT_MS); });
    try { await Promise.race([signal, late]); } finally { clearTimeout(timer); }
    return result;
  } finally { stop(); }
}
