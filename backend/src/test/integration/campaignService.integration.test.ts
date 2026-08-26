import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createCampaign } from '../../services/campaignService';
import { getEmailQueueJob } from '../../queue/queue';
import { resetDatabase, seedTestUser, seedTestSender, closeAll } from './setup';

describe('campaignService.createCampaign (real Postgres + real BullMQ/Redis)', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeAll();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates one email_jobs row per recipient with correctly spaced scheduled times, and a live BullMQ job for each', async () => {
    const user = await seedTestUser();
    const sender = await seedTestSender();
    const startTime = new Date(Date.now() + 60_000);

    const { campaign, jobs } = await createCampaign({
      userId: user.id,
      subject: 'Hello',
      body: '<p>Hi there</p>',
      senderId: sender.id,
      startTime,
      delayBetweenEmailsMs: 2000,
      hourlyLimit: 1000,
      recipients: ['a@example.com', 'b@example.com', 'c@example.com'],
    });

    expect(campaign.subject).toBe('Hello');
    expect(jobs).toHaveLength(3);
    expect(jobs.map((j) => j.recipientEmail)).toEqual(['a@example.com', 'b@example.com', 'c@example.com']);
    expect(jobs.every((j) => j.status === 'scheduled')).toBe(true);

    expect(jobs[0].scheduledTime.getTime()).toBe(startTime.getTime());
    expect(jobs[1].scheduledTime.getTime()).toBe(startTime.getTime() + 2000);
    expect(jobs[2].scheduledTime.getTime()).toBe(startTime.getTime() + 4000);

    // Every row must have a real, live BullMQ delayed job backing it.
    for (const job of jobs) {
      const bullJob = await getEmailQueueJob(job.id);
      expect(bullJob).toBeDefined();
      expect(bullJob?.data.emailJobId).toBe(job.id);
      expect(bullJob?.opts.delay).toBeGreaterThan(0);
    }
  });

  it('rolls recipients into the next hour window when hourlyLimit is exceeded', async () => {
    const user = await seedTestUser();
    const sender = await seedTestSender();
    const startTime = new Date('2030-01-01T10:00:00.000Z');

    const { jobs } = await createCampaign({
      userId: user.id,
      subject: 'Batch',
      body: '<p>Hi</p>',
      senderId: sender.id,
      startTime,
      delayBetweenEmailsMs: 0,
      hourlyLimit: 2,
      recipients: ['a@example.com', 'b@example.com', 'c@example.com'],
    });

    expect(jobs[0].scheduledTime.toISOString()).toBe('2030-01-01T10:00:00.000Z');
    expect(jobs[1].scheduledTime.toISOString()).toBe('2030-01-01T10:00:00.000Z');
    expect(jobs[2].scheduledTime.toISOString()).toBe('2030-01-01T11:00:00.000Z');
  });
});
