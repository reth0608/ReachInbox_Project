import { computeSchedule } from './scheduleSimulator';
import { createCampaignWithJobs, type CreatedCampaign } from '../db/repositories/campaignsRepository';
import { scheduleEmailJob } from '../queue/queue';
import { childLogger } from '../utils/logger';

const log = childLogger('campaignService');

export interface CreateCampaignServiceInput {
  userId: string;
  subject: string;
  body: string;
  senderId: string;
  startTime: Date;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
  recipients: string[];
}

/**
 * The full "compose -> scheduled" flow:
 *   1. Compute every recipient's scheduled_time deterministically, up
 *      front (scheduleSimulator).
 *   2. Persist the campaign + all email_jobs rows as 'scheduled' in one
 *      DB transaction (source of truth committed first).
 *   3. Only then, add the BullMQ delayed jobs.
 *
 * Step 3 is deliberately outside the DB transaction - Redis isn't
 * transactional with Postgres, so there's no way to make "commit the rows"
 * and "enqueue the jobs" atomic across both systems. Instead, each enqueue
 * uses the row's own id as the BullMQ jobId, so it's safe to retry, and
 * the startup reconciliation pass (services/reconciliation.ts) is the
 * backstop that catches anything that fails to enqueue here.
 */
export async function createCampaign(input: CreateCampaignServiceInput): Promise<CreatedCampaign> {
  const schedule = computeSchedule({
    startTime: input.startTime,
    delayBetweenEmailsMs: input.delayBetweenEmailsMs,
    hourlyLimit: input.hourlyLimit,
    recipients: input.recipients,
  });

  const created = await createCampaignWithJobs({
    userId: input.userId,
    subject: input.subject,
    body: input.body,
    senderId: input.senderId,
    delayBetweenEmailsMs: input.delayBetweenEmailsMs,
    hourlyLimit: input.hourlyLimit,
    startTime: input.startTime,
    jobs: schedule.map((s) => ({
      recipientEmail: s.recipientEmail,
      scheduledTime: s.scheduledTime,
    })),
  });

  const results = await Promise.allSettled(
    created.jobs.map((job) =>
      scheduleEmailJob({ jobId: job.id, emailJobId: job.id, scheduledTime: job.scheduledTime }),
    ),
  );

  const failedCount = results.filter((r) => r.status === 'rejected').length;
  if (failedCount > 0) {
    log.error(
      { failedCount, campaignId: created.campaign.id, total: created.jobs.length },
      'some jobs failed to enqueue after commit; startup reconciliation will recreate them',
    );
  }

  return created;
}
