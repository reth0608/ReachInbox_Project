import type { Redis } from 'ioredis';

const HOUR_SECONDS = 60 * 60;
const HOUR_MS = HOUR_SECONDS * 1000;

/**
 * Atomically checks the current count against the limit AND increments in
 * the same Redis command, but ONLY if there is still room. This does two
 * things at once:
 *
 *  1. It's race-free across any number of worker processes - GET+compare+
 *     INCR all happen inside a single Lua execution, which Redis runs to
 *     completion without interleaving another client's command.
 *  2. It never "spends" a slot on a request that was going to be rejected
 *     anyway - a naive INCR-then-check approach would increment first and
 *     find out it went over after the fact, permanently wasting that slot
 *     even though nothing was sent. Checking before incrementing avoids
 *     that.
 *
 * Combined with claiming the DB row *before* calling this (see
 * emailJobsRepository.tryClaimEmailJobForProcessing), a job that loses the
 * DB claim race never reaches this script at all, so it never consumes an
 * hourly slot for an email someone else is about to send.
 */
const CHECK_AND_INCREMENT_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local limit = tonumber(ARGV[1])
if current < limit then
  local new = redis.call('INCR', KEYS[1])
  if new == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[2])
  end
  return {1, new}
else
  return {0, current}
end
`;

function hourWindowKey(senderId: string, at: Date): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, '0');
  const d = String(at.getUTCDate()).padStart(2, '0');
  const h = String(at.getUTCHours()).padStart(2, '0');
  return `rl:${senderId}:${y}${m}${d}${h}`;
}

export function hourWindowStart(at: Date): Date {
  const d = new Date(at);
  d.setUTCMinutes(0, 0, 0);
  return d;
}

export function nextHourWindowStart(at: Date): Date {
  return new Date(hourWindowStart(at).getTime() + HOUR_MS);
}

export interface RateLimitResult {
  /** True if the caller may proceed to send. */
  allowed: boolean;
  /** The counter's value after this call. */
  count: number;
  windowKey: string;
  /** Where a rejected caller should be rescheduled to. */
  nextWindowStart: Date;
}

/**
 * Enforces "at most `hourlyLimit` sends per sender per UTC clock-hour",
 * safely across concurrent workers/processes. Fixed clock-hour windows
 * (rather than a sliding 60-minute window) are used deliberately for
 * simplicity and predictability - see README for the trade-off discussion.
 */
export async function checkAndIncrementHourlyLimit(
  redis: Redis,
  senderId: string,
  hourlyLimit: number,
  at: Date = new Date(),
): Promise<RateLimitResult> {
  const key = hourWindowKey(senderId, at);

  const raw = (await redis.eval(
    CHECK_AND_INCREMENT_SCRIPT,
    1,
    key,
    hourlyLimit,
    HOUR_SECONDS,
  )) as [number, number];

  const [allowedFlag, count] = raw;

  return {
    allowed: allowedFlag === 1,
    count,
    windowKey: key,
    nextWindowStart: nextHourWindowStart(at),
  };
}

/**
 * Compensating action for the rare case where a job is claimed and passes
 * the rate-limit check, but then fails to actually send (e.g. SMTP throws)
 * before BullMQ's retry re-attempts it. Without this, a transient SMTP
 * failure would permanently burn an hourly slot for an email that never
 * left the building. Not required for the reactive-reschedule path (that
 * path never increments in the first place, by design).
 */
export async function releaseHourlyLimitSlot(
  redis: Redis,
  senderId: string,
  at: Date = new Date(),
): Promise<void> {
  const key = hourWindowKey(senderId, at);
  const current = await redis.get(key);
  if (current && Number(current) > 0) {
    await redis.decr(key);
  }
}
