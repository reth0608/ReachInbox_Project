import { Queue } from 'bullmq';
import { createRedisConnection } from './redisClient';

export const EMAIL_QUEUE_NAME = 'email-jobs';

export interface EmailJobPayload {
  emailJobId: string;
}

export const emailQueue = new Queue<EmailJobPayload>(EMAIL_QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    // Keep a bounded history for observability without letting Redis grow
    // unbounded; the DB (not BullMQ) is the durable record either way.
    removeOnComplete: { count: 1000, age: 24 * 60 * 60 },
    removeOnFail: { count: 5000, age: 7 * 24 * 60 * 60 },
  },
});

/**
 * Schedules (or re-schedules) a single email_jobs row as a BullMQ delayed
 * job. Uses `emailJobId` as the BullMQ jobId is used for the row's very
 * first schedule; reschedules (see jobs/sendEmail.ts) pass a derived id
 * instead, but always route through this same function.
 *
 * Idempotent by construction: BullMQ's `add()` treats an existing jobId as
 * a no-op (it returns the existing job rather than creating a duplicate),
 * so calling this twice for the same jobId - e.g. because an API request
 * was retried, or reconciliation runs again before its previous pass
 * finished - never produces two delayed jobs for the same email.
 */
export async function scheduleEmailJob(params: {
  jobId: string;
  emailJobId: string;
  scheduledTime: Date;
}): Promise<void> {
  const delay = Math.max(0, params.scheduledTime.getTime() - Date.now());
  await emailQueue.add(
    'send-email',
    { emailJobId: params.emailJobId },
    {
      jobId: params.jobId,
      delay,
    },
  );
}

export async function getEmailQueueJob(jobId: string) {
  return emailQueue.getJob(jobId);
}

export async function closeEmailQueue(): Promise<void> {
  await emailQueue.close();
}
