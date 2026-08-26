import { describe, it, expect } from 'vitest';
import { computeSchedule } from './scheduleSimulator';

const START = new Date('2026-01-01T10:00:00.000Z');

function recipients(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `user${i}@example.com`);
}

describe('computeSchedule', () => {
  it('is deterministic - same input always produces the same output', () => {
    const input = {
      startTime: START,
      delayBetweenEmailsMs: 5000,
      hourlyLimit: 10,
      recipients: recipients(5),
    };
    const a = computeSchedule(input);
    const b = computeSchedule(input);
    expect(a.map((r) => r.scheduledTime.getTime())).toEqual(b.map((r) => r.scheduledTime.getTime()));
  });

  it('applies start_time to the first recipient', () => {
    const [first] = computeSchedule({
      startTime: START,
      delayBetweenEmailsMs: 1000,
      hourlyLimit: 100,
      recipients: recipients(1),
    });
    expect(first.scheduledTime.getTime()).toBe(START.getTime());
  });

  it('spaces consecutive recipients by exactly delayBetweenEmailsMs when under the hourly cap', () => {
    const result = computeSchedule({
      startTime: START,
      delayBetweenEmailsMs: 2000,
      hourlyLimit: 1000,
      recipients: recipients(4),
    });
    const times = result.map((r) => r.scheduledTime.getTime());
    expect(times).toEqual([
      START.getTime(),
      START.getTime() + 2000,
      START.getTime() + 4000,
      START.getTime() + 6000,
    ]);
  });

  it('preserves recipient order (non-decreasing scheduled times, matching input order)', () => {
    const input = recipients(50);
    const result = computeSchedule({
      startTime: START,
      delayBetweenEmailsMs: 500,
      hourlyLimit: 5,
      recipients: input,
    });
    expect(result.map((r) => r.recipientEmail)).toEqual(input);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].scheduledTime.getTime()).toBeGreaterThanOrEqual(
        result[i - 1].scheduledTime.getTime(),
      );
    }
  });

  it('rolls remaining recipients into the next hour once hourlyLimit is hit', () => {
    // 3 recipients, limit 2/hour, tiny delay -> 3rd recipient must roll to the next hour.
    const result = computeSchedule({
      startTime: START,
      delayBetweenEmailsMs: 1000,
      hourlyLimit: 2,
      recipients: recipients(3),
    });

    expect(result[0].scheduledTime.getTime()).toBe(START.getTime());
    expect(result[1].scheduledTime.getTime()).toBe(START.getTime() + 1000);

    const nextHour = new Date('2026-01-01T11:00:00.000Z').getTime();
    expect(result[2].scheduledTime.getTime()).toBe(nextHour);
  });

  it('can roll across multiple empty hours when the batch is large relative to the limit', () => {
    // limit 1/hour, 3 recipients -> hour 10, hour 11, hour 12
    const result = computeSchedule({
      startTime: START,
      delayBetweenEmailsMs: 0,
      hourlyLimit: 1,
      recipients: recipients(3),
    });
    expect(result.map((r) => r.scheduledTime.toISOString())).toEqual([
      '2026-01-01T10:00:00.000Z',
      '2026-01-01T11:00:00.000Z',
      '2026-01-01T12:00:00.000Z',
    ]);
  });

  it('handles the exact-hour-boundary case: a start time exactly on the hour counts toward that hour', () => {
    const onTheHour = new Date('2026-01-01T09:00:00.000Z');
    const result = computeSchedule({
      startTime: onTheHour,
      delayBetweenEmailsMs: 0,
      hourlyLimit: 1,
      recipients: recipients(2),
    });
    expect(result[0].scheduledTime.toISOString()).toBe('2026-01-01T09:00:00.000Z');
    // second recipient exceeds the 09:00 window's limit of 1, rolls to 10:00 exactly
    expect(result[1].scheduledTime.toISOString()).toBe('2026-01-01T10:00:00.000Z');
  });

  it('handles a start time one millisecond before the hour boundary', () => {
    const almostHour = new Date('2026-01-01T09:59:59.999Z');
    const result = computeSchedule({
      startTime: almostHour,
      delayBetweenEmailsMs: 0,
      hourlyLimit: 1,
      recipients: recipients(2),
    });
    expect(result[0].scheduledTime.toISOString()).toBe('2026-01-01T09:59:59.999Z');
    // still within the 09:00 window, so the 2nd recipient rolls to 10:00, not 11:00
    expect(result[1].scheduledTime.toISOString()).toBe('2026-01-01T10:00:00.000Z');
  });

  it('a large delay that itself crosses into the next hour window is respected', () => {
    const result = computeSchedule({
      startTime: new Date('2026-01-01T09:50:00.000Z'),
      delayBetweenEmailsMs: 20 * 60 * 1000, // 20 min
      hourlyLimit: 100,
      recipients: recipients(2),
    });
    expect(result[0].scheduledTime.toISOString()).toBe('2026-01-01T09:50:00.000Z');
    expect(result[1].scheduledTime.toISOString()).toBe('2026-01-01T10:10:00.000Z');
  });

  it('throws on invalid hourlyLimit', () => {
    expect(() =>
      computeSchedule({
        startTime: START,
        delayBetweenEmailsMs: 0,
        hourlyLimit: 0,
        recipients: recipients(1),
      }),
    ).toThrow();
  });

  it('throws on negative delay', () => {
    expect(() =>
      computeSchedule({
        startTime: START,
        delayBetweenEmailsMs: -1,
        hourlyLimit: 10,
        recipients: recipients(1),
      }),
    ).toThrow();
  });

  it('returns an empty array for an empty recipient list', () => {
    expect(
      computeSchedule({
        startTime: START,
        delayBetweenEmailsMs: 1000,
        hourlyLimit: 10,
        recipients: [],
      }),
    ).toEqual([]);
  });

  it('handles 1000+ recipients without pathological slowdown', () => {
    const big = recipients(1200);
    const start = performance.now();
    const result = computeSchedule({
      startTime: START,
      delayBetweenEmailsMs: 100,
      hourlyLimit: 50,
      recipients: big,
    });
    const elapsed = performance.now() - start;
    expect(result).toHaveLength(1200);
    expect(elapsed).toBeLessThan(200);
  });
});
