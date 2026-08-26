import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '../../db/client';
import { campaigns, emailJobs } from '../../db/schema';
import { createCampaign } from '../../services/campaignService';
import { getEmailQueueJob } from '../../queue/queue';
import { runReconciliation } from '../../services/reconciliation';
import { findEmailJobById } from '../../db/repositories/emailJobsRepository';
import { resetDatabase, seedTestUser, seedTestSender, closeAll } from './setup';

describe('reconciliation (real Postgres + real BullMQ/Redis)', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeAll();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  it('recreates a BullMQ job for a scheduled row whose job was lost (e.g. Redis flush)', async () => {
    const user = await seedTestUser();
    const sender = await seedTestSender();

    const { jobs } = await createCampaign({
      userId: user.id,
      subject: 'Recovery test',
      body: '<p>hi</p>',
      senderId: sender.id,
      startTime: new Date(Date.now() + 5 * 60_000),
      delayBetweenEmailsMs: 1000,
      hourlyLimit: 100,
      recipients: ['a@example.com'],
    });
    const rowId = jobs[0].id;

    // Simulate Redis/BullMQ state loss for this specific job.
    const bullJob = await getEmailQueueJob(rowId);
    expect(bullJob).toBeDefined();
    await bullJob?.remove();
    expect(await getEmailQueueJob(rowId)).toBeUndefined();

    const result = await runReconciliation();
    expect(result.recreated).toBeGreaterThanOrEqual(1);

    const recreatedJob = await getEmailQueueJob(rowId);
    expect(recreatedJob).toBeDefined();
    expect(recreatedJob?.data.emailJobId).toBe(rowId);
  });

  it('recovers a row stuck in "processing" from a crashed worker, and gives it a live job again', async () => {
    const user = await seedTestUser();
    const sender = await seedTestSender();

    const [campaign] = await db
      .insert(campaigns)
      .values({
        userId: user.id,
        subject: 'Stuck',
        body: '<p>hi</p>',
        senderId: sender.id,
        delayBetweenEmailsMs: 1000,
        hourlyLimit: 100,
        startTime: new Date(),
      })
      .returning();

    const staleUpdatedAt = new Date(Date.now() - 10 * 60_000); // 10 minutes ago
    const [row] = await db
      .insert(emailJobs)
      .values({
        campaignId: campaign.id,
        recipientEmail: 'stuck@example.com',
        status: 'processing',
        scheduledTime: new Date(Date.now() - 11 * 60_000),
        updatedAt: staleUpdatedAt,
      })
      .returning();

    // PROCESSING_STALE_TIMEOUT_MS defaults to 120000ms (2 min) - 10 minutes
    // definitely qualifies as stale.
    const result = await runReconciliation();
    expect(result.staleProcessingRecovered).toBeGreaterThanOrEqual(1);

    const recovered = await findEmailJobById(row.id);
    expect(recovered?.status).toBe('scheduled');

    const bullJob = recovered?.bullmqJobId ? await getEmailQueueJob(recovered.bullmqJobId) : null;
    expect(bullJob).toBeDefined();
  });
});
