import { Redis } from 'ioredis';
import { env } from '../env.js';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  connectTimeout: 3000,
});

let connection: Promise<void> | undefined;

export async function ensureRedisReady() {
  if (redis.status === 'ready') return;
  if (redis.status === 'end') throw new Error('Redis connection has ended.');
  if (!connection) {
    const attempt = redis.status === 'wait'
      ? redis.connect()
      : new Promise<void>((resolve, reject) => {
          const ready = () => { cleanup(); resolve(); };
          const error = (cause: Error) => { cleanup(); reject(cause); };
          const timer = setTimeout(() => error(new Error('Redis connection timed out.')), 3000);
          const cleanup = () => { clearTimeout(timer); redis.off('ready', ready); redis.off('error', error); };
          redis.once('ready', ready);
          redis.once('error', error);
        });
    let deadline: ReturnType<typeof setTimeout>;
    connection = Promise.race([
      attempt,
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Redis connection timed out.')), 3000); }),
    ]).finally(() => clearTimeout(deadline));
  }
  try {
    await connection;
  } finally {
    connection = undefined;
  }
}
