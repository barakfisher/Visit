import { prisma } from '../db/client.js';
import { env } from '../env.js';
export type ReviewDelivery = { available: boolean; send(input: { id: string; to: string; decision: string; reason: string; locale: string | null }): Promise<string> };
export function createReviewDelivery({ mode = env.EMAIL_DELIVERY_MODE, key = env.EMAIL_API_KEY, from = env.EMAIL_FROM, transport = fetch }: { mode?: string; key?: string | undefined; from?: string; transport?: typeof fetch } = {}): ReviewDelivery {
  return { available: mode === 'local-inbox' || Boolean(key), async send(input) {
    if (mode === 'local-inbox') return 'local-inbox';
    if (!key) throw new Error('Delivery unavailable');
    const he = input.locale !== 'en';
    const decision = input.decision === 'APPROVED' ? he ? 'אושרה' : 'approved' : he ? 'נדחתה' : 'rejected';
    try {
      const response = await transport('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': `provider-review/${input.id}` }, signal: AbortSignal.timeout(10000), body: JSON.stringify({ from, to: [input.to], subject: he ? 'עדכון הבקשה העסקית ב־Visit' : 'Your Visit business application', text: he ? `הבקשה שלכם ${decision}.\n${input.reason}\nהסטטוס מופיע גם בחשבון Visit. אישור הבקשה לא מפרסם את העסק.` : `Your application was ${decision}.\n${input.reason}\nYou can also view status in your Visit account. Approval does not publish your business.` }) });
      if (!response.ok || typeof (await response.json() as { id?: unknown }).id !== 'string') throw new Error('Delivery failed');
      return 'resend';
    } catch { throw new Error('Delivery failed'); } // Do not retain provider payloads or recipient details in errors.
  } };
}
export function createReviewNotificationWorker(delivery = createReviewDelivery(), scope = 'live') {
  let active: Promise<void> | undefined, stopped = false;
  async function drain() {
    await prisma.providerReviewNotification.updateMany({ where: { scope, destination: { not: null }, createdAt: { lt: new Date(Date.now() - 7 * 86400000) } }, data: { destination: null, status: 'FAILED', leaseUntil: null } });
    for (let i = 0; i < 10 && !stopped; i++) {
      const now = new Date(), lease = new Date(Date.now() + 30000);
      const item = await prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ProviderReviewNotification" WHERE scope = ${scope} AND destination IS NOT NULL AND ((status IN ('QUEUED','BLOCKED') AND "nextAttemptAt" <= ${now}) OR (status = 'SENDING' AND "leaseUntil" <= ${now})) ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1`;
        if (!rows[0]) return null;
        return tx.providerReviewNotification.update({ where: { id: rows[0].id }, data: { status: 'SENDING', leaseUntil: lease }, include: { application: { include: { identity: { select: { email: true, emailVerifiedAt: true } } } } } });
      });
      if (!item?.destination) return;
      const where = { id: item.id, status: 'SENDING', leaseUntil: lease };
      if (!item.application.identity.emailVerifiedAt || item.application.identity.email !== item.destination) {
        await prisma.providerReviewNotification.updateMany({ where, data: { status: 'IN_APP', destination: null, leaseUntil: null } }); continue;
      }
      if (!delivery.available) { await prisma.providerReviewNotification.updateMany({ where, data: { status: 'BLOCKED', leaseUntil: null, nextAttemptAt: new Date(Date.now() + 300000) } }); continue; }
      try {
        const provider = await delivery.send({ id: item.id, to: item.destination, decision: item.application.status, reason: item.application.reviewReason ?? '', locale: item.locale });
        await prisma.providerReviewNotification.updateMany({ where, data: { status: provider === 'local-inbox' ? 'LOCAL' : 'ACCEPTED', provider, acceptedAt: new Date(), destination: null, leaseUntil: null, attempts: { increment: 1 } } });
      } catch {
        const failed = item.attempts + 1 >= 5;
        await prisma.providerReviewNotification.updateMany({ where, data: { status: failed ? 'FAILED' : 'QUEUED', attempts: { increment: 1 }, ...(failed ? { destination: null } : {}), leaseUntil: null, nextAttemptAt: new Date(Date.now() + 30000 * 2 ** item.attempts) } });
      }
    }
  }
  return { run() { return stopped ? Promise.resolve() : active ??= drain().finally(() => { active = undefined; }); }, async stop() { stopped = true; await active; } };
}
export function startReviewNotificationWorker() {
  const worker = createReviewNotificationWorker();
  const run = () => void worker.run().catch(() => {});
  const timer = setInterval(run, 10000); timer.unref(); run();
  return async () => { clearInterval(timer); await worker.stop(); };
}
