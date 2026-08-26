const HOUR_MS = 60 * 60 * 1000;

export interface ScheduleSimulatorInput {
  /** The earliest moment the first email may go out. */
  startTime: Date;
  /** Minimum spacing enforced between two consecutive sends. */
  delayBetweenEmailsMs: number;
  /** Max sends allowed within any single clock-hour window. */
  hourlyLimit: number;
  /** Recipient addresses, in the order they should be sent. */
  recipients: string[];
}

export interface ScheduledRecipient {
  recipientEmail: string;
  scheduledTime: Date;
}

/**
 * Floors a timestamp to the start of its UTC clock-hour, e.g.
 * 14:37:12.500 -> 14:00:00.000. Hourly windows are defined on UTC clock
 * hours (not sliding 60-minute windows) - see README for the trade-off.
 */
function hourWindowStart(t: Date): number {
  const d = new Date(t);
  d.setUTCMinutes(0, 0, 0);
  return d.getTime();
}

/**
 * Computes a deterministic scheduled_time for every recipient, up front,
 * before anything touches the queue.
 *
 * Rules applied in order for each recipient:
 *  1. It may not go out before `previous send time + delayBetweenEmailsMs`
 *     (or before `startTime`, for the very first recipient).
 *  2. It may not push the count of that clock-hour above `hourlyLimit` -
 *     if it would, it rolls forward to the start of the next hour window
 *     instead (and is re-checked there, in case that window is somehow
 *     already fully booked too, though within a single campaign that
 *     cannot happen since we only ever move forward in time).
 *
 * The result is order-preserving: recipient i's scheduled_time is always
 * >= recipient i-1's scheduled_time, by construction.
 */
export function computeSchedule(input: ScheduleSimulatorInput): ScheduledRecipient[] {
  const { startTime, delayBetweenEmailsMs, hourlyLimit, recipients } = input;

  if (hourlyLimit < 1) {
    throw new Error('hourlyLimit must be at least 1');
  }
  if (delayBetweenEmailsMs < 0) {
    throw new Error('delayBetweenEmailsMs cannot be negative');
  }

  const countInWindow = new Map<number, number>();
  const results: ScheduledRecipient[] = [];

  let cursor = startTime.getTime();

  for (const recipientEmail of recipients) {
    let candidate = cursor;

    // Roll forward across as many hour windows as needed until we find one
    // with spare capacity. Bounded: each iteration jumps a full hour, and
    // a freshly-started window always has count 0, so this always
    // terminates.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const window = hourWindowStart(new Date(candidate));
      const countSoFar = countInWindow.get(window) ?? 0;

      if (countSoFar < hourlyLimit) {
        countInWindow.set(window, countSoFar + 1);
        results.push({ recipientEmail, scheduledTime: new Date(candidate) });
        cursor = candidate + delayBetweenEmailsMs;
        break;
      }

      candidate = window + HOUR_MS;
    }
  }

  return results;
}
