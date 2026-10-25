import { startReviewNotificationWorker } from './security/provider-review-notifications.js';
import { startSecurityNotificationWorker } from './security/security-notifications.js';
import { createApp } from './app.js';
import { env } from './env.js';
import { redis } from './infra/redis.js';
import { prisma } from './db/client.js';

const app = await createApp();
const stopReviewNotifications = startReviewNotificationWorker();
const stopNotifications = startSecurityNotificationWorker();
const close = async () => {
  await stopNotifications();
  await stopReviewNotifications();
  await app.close();
  await Promise.allSettled([redis.quit(), prisma.$disconnect()]);
};
process.once('SIGINT', () => void close().then(() => process.exit(0)));
process.once('SIGTERM', () => void close().then(() => process.exit(0)));
await app.listen({ host: env.API_HOST, port: env.API_PORT });
