import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { emailJobs } from '../../db/schema';
import { tryClaimEmailJobForProcessing, findEmailJobById } from '../../db/repositories/emailJobsRepository';
import { createCampaignWithJobs } from '../../db/repositories/campaignsRepository';
import { resetDatabase, seedTestUser, seedTestSender, closeAll } from './setup';

describe('idempotency: atomic claim (real Postgres)', () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeAll();
  });

  let jobId: string;

  beforeEach(async () => {
    await resetDatabase();
    const user = await seedTestUser();
    const sender = await seedTestSender();
    const { jobs } = await createCampaignWithJobs({
      userId: user.id,
      subject: 'Test',
      body: '<p>hi</p>',
      senderId: sender.id,
      delayBetweenEmailsMs: 1000,
      hourlyLimit: 100,
      startTime: new Date(),
      jobs: [{ recipientEmail: 'a@example.com', scheduledTime: new Date() }],
    });
    jobId = jobs[0].id;
  });

  it('only one of many concurrent claim attempts on the same row succeeds', async () => {
    const attempts = 25;
    const results = await Promise.all(
      Array.from({ length: attempts }, () => tryClaimEmailJobForProcessing(jobId)),
    );

    const successCount = results.filter(Boolean).length;
    expect(successCount).toBe(1);

    const row = await findEmailJobById(jobId);
    expect(row?.status).toBe('processing');
  });

  it('a second claim attempt after the row is already processing correctly fails', async () => {
    const first = await tryClaimEmailJobForProcessing(jobId);
    expect(first).toBe(true);

    const second = await tryClaimEmailJobForProcessing(jobId);
    expect(second).toBe(false);
  });

  it('a row that is already sent cannot be re-claimed', async () => {
    await db.update(emailJobs).set({ status: 'sent', sentAt: new Date() }).where(eq(emailJobs.id, jobId));

    const claimed = await tryClaimEmailJobForProcessing(jobId);
    expect(claimed).toBe(false);

    const row = await findEmailJobById(jobId);
    expect(row?.status).toBe('sent');
  });
});
