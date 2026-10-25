import { prisma } from '../db/client.js';
import { accountDelivery, type AccountDelivery, type AccountChannel } from './account-delivery.js';

/** Durable at-least-once alerts. ACCEPTED is a provider acknowledgement, not delivery evidence. */
export function createSecurityNotificationWorker(delivery: AccountDelivery = accountDelivery, scope = 'live') {
  let active: Promise<void> | undefined, stopped = false;
  async function drain() {
    await prisma.accountContactChallenge.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86400000) } } });
    // Bound private recipient retention, including permanently unconfigured channels.
    await prisma.securityNotification.updateMany({ where: { scope, destination: { not: null }, createdAt: { lt: new Date(Date.now() - 7 * 86400000) } }, data: { status: 'FAILED', destination: null, leaseUntil: null } });
    for (let iteration = 0; iteration < 10 && !stopped; iteration++) {
      const now = new Date(), lease = new Date(Date.now() + 30000);
      const item = await prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "SecurityNotification" WHERE scope = ${scope} AND "destination" IS NOT NULL AND (("status" IN ('QUEUED','BLOCKED') AND "nextAttemptAt" <= ${now}) OR ("status" = 'SENDING' AND "leaseUntil" <= ${now})) ORDER BY "createdAt", id FOR UPDATE SKIP LOCKED LIMIT 1`;
        if (!rows[0]) return null;
        return tx.securityNotification.update({ where: { id: rows[0].id }, data: { status: 'SENDING', leaseUntil: lease }, include: { identity: { select: { preferredLocale: true } } } });
      });
      if (!item?.destination) return;
      if (!delivery.available(item.channel as AccountChannel)) {
        await prisma.securityNotification.updateMany({ where: { id: item.id, status: 'SENDING', leaseUntil: lease }, data: { status: 'BLOCKED', leaseUntil: null, nextAttemptAt: new Date(Date.now() + 300000) } }); continue;
      }
      try {
        const provider = await delivery.alert({ channel: item.channel as AccountChannel, destination: item.destination, id: item.id, locale: item.identity.preferredLocale });
        await prisma.securityNotification.updateMany({ where: { id: item.id, status: 'SENDING', leaseUntil: lease }, data: { status: 'ACCEPTED', provider, acceptedAt: new Date(), destination: null, leaseUntil: null, attempts: { increment: 1 } } });
      } catch {
        const failed = item.attempts + 1 >= 5;
        await prisma.securityNotification.updateMany({ where: { id: item.id, status: 'SENDING', leaseUntil: lease }, data: { status: failed ? 'FAILED' : 'QUEUED', leaseUntil: null, ...(failed ? { destination: null } : {}), attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** item.attempts)) } });
      }
    }
  }
  return { run() { if (stopped) return Promise.resolve(); return active ??= drain().finally(() => { active = undefined; }); }, async stop() { stopped = true; await active; } };
}
export function startSecurityNotificationWorker() {
  const worker = createSecurityNotificationWorker();
  // No provider payloads, destinations or errors are logged by this worker.
  const run = () => void worker.run().catch(() => {});
  const timer = setInterval(run, 10000); timer.unref(); run();
  return async () => { clearInterval(timer); await worker.stop(); };
}
