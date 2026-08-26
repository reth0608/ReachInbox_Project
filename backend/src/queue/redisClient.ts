import IORedis, { type Redis } from 'ioredis';
import { env } from '../config/env';

/**
 * BullMQ requires maxRetriesPerRequest: null on any connection it manages.
 * We create one shared connection and reuse it everywhere (queue, worker,
 * rate limiter, reconciliation) rather than opening a new socket per
 * consumer.
 */
export function createRedisConnection(): Redis {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
}

export const redis = createRedisConnection();
