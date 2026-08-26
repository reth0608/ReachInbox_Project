import { describe, it, expect, beforeEach } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import RedisMock from 'ioredis-mock';
import type { Redis } from 'ioredis';
import {
  checkAndIncrementHourlyLimit,
  releaseHourlyLimitSlot,
  hourWindowStart,
  nextHourWindowStart,
} from './rateLimiter';

describe('rateLimiter', () => {
  let redis: Redis;

  beforeEach(async () => {
    // ioredis-mock instances share one in-memory store by default (mirroring
    // how multiple real clients share one Redis server), so each test must
    // start from a clean slate explicitly.
    redis = new RedisMock() as unknown as Redis;
    await redis.flushall();
  });

  it('allows sends up to the hourly limit and rejects beyond it', async () => {
    const at = new Date('2026-01-01T10:15:00.000Z');
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await checkAndIncrementHourlyLimit(redis, 'sender-a', 3, at));
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results.map((r) => r.count)).toEqual([1, 2, 3, 3, 3]);
  });

  it('does not increment the counter on a rejected attempt', async () => {
    const at = new Date('2026-01-01T10:15:00.000Z');
    await checkAndIncrementHourlyLimit(redis, 'sender-a', 1, at);
    const second = await checkAndIncrementHourlyLimit(redis, 'sender-a', 1, at);
    const third = await checkAndIncrementHourlyLimit(redis, 'sender-a', 1, at);
    expect(second.allowed).toBe(false);
    expect(third.allowed).toBe(false);
    expect(second.count).toBe(1);
    expect(third.count).toBe(1);
  });

  it('isolates counters per sender', async () => {
    const at = new Date('2026-01-01T10:15:00.000Z');
    await checkAndIncrementHourlyLimit(redis, 'sender-a', 1, at);
    const b = await checkAndIncrementHourlyLimit(redis, 'sender-b', 1, at);
    expect(b.allowed).toBe(true);
    expect(b.count).toBe(1);
  });

  it('rolls over to a fresh counter in the next hour window', async () => {
    const hour10 = new Date('2026-01-01T10:59:59.000Z');
    const hour11 = new Date('2026-01-01T11:00:00.000Z');
    await checkAndIncrementHourlyLimit(redis, 'sender-a', 1, hour10);
    const next = await checkAndIncrementHourlyLimit(redis, 'sender-a', 1, hour11);
    expect(next.allowed).toBe(true);
    expect(next.count).toBe(1);
  });

  it('remains correct under concurrent access from multiple "workers"', async () => {
    const at = new Date('2026-01-01T10:15:00.000Z');
    const limit = 20;
    const attempts = 100;

    const outcomes = await Promise.all(
      Array.from({ length: attempts }, () =>
        checkAndIncrementHourlyLimit(redis, 'sender-a', limit, at),
      ),
    );

    const allowedCount = outcomes.filter((o) => o.allowed).length;
    // Exactly `limit` of the concurrent attempts should have won, no matter
    // how they interleaved - this is what atomicity buys us.
    expect(allowedCount).toBe(limit);
  });

  it('releaseHourlyLimitSlot decrements the counter to compensate a failed send', async () => {
    const at = new Date('2026-01-01T10:15:00.000Z');
    await checkAndIncrementHourlyLimit(redis, 'sender-a', 5, at);
    await checkAndIncrementHourlyLimit(redis, 'sender-a', 5, at);
    await releaseHourlyLimitSlot(redis, 'sender-a', at);
    const third = await checkAndIncrementHourlyLimit(redis, 'sender-a', 5, at);
    expect(third.count).toBe(2); // 2 - 1 (release) + 1 (this call)
  });

  it('nextHourWindowStart / hourWindowStart compute the correct boundaries', () => {
    const at = new Date('2026-01-01T10:37:12.345Z');
    expect(hourWindowStart(at).toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(nextHourWindowStart(at).toISOString()).toBe('2026-01-01T11:00:00.000Z');
  });
});
