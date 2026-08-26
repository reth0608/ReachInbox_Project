import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../client';
import { campaigns, emailJobs, type EmailJob } from '../schema';

export async function findEmailJobById(id: string): Promise<EmailJob | undefined> {
  const [row] = await db.select().from(emailJobs).where(eq(emailJobs.id, id)).limit(1);
  return row;
}

/**
 * The single duplicate-send guard for the whole system.
 *
 * Atomically transitions a row from 'scheduled' -> 'processing'. Because
 * this is one UPDATE ... WHERE ... RETURNING statement, Postgres guarantees
 * only one caller can ever see a returned row for a given id, even if two
 * workers (or two BullMQ jobs referencing the same row) race to process it
 * at the same instant. Whoever gets a row back "owns" the send; everyone
 * else must treat a miss as "already being handled, do nothing".
 *
 * BullMQ's jobId dedup only prevents a second *delayed job* from being
 * scheduled - it does nothing to stop two *attempts* at the same job (e.g.
 * a retry after a crash) from both reaching the SMTP call. This claim is
 * what actually stops that.
 */
export async function tryClaimEmailJobForProcessing(id: string): Promise<boolean> {
  const result = await db
    .update(emailJobs)
    .set({ status: 'processing' })
    .where(and(eq(emailJobs.id, id), eq(emailJobs.status, 'scheduled')))
    .returning({ id: emailJobs.id });

  return result.length === 1;
}

export async function markEmailJobSent(id: string, sentAt: Date): Promise<void> {
  await db
    .update(emailJobs)
    .set({ status: 'sent', sentAt, errorMessage: null })
    .where(eq(emailJobs.id, id));
}

/**
 * Records a failed send attempt. `final` indicates BullMQ has exhausted its
 * retries, in which case the row is marked permanently 'failed'; otherwise
 * it is returned to 'scheduled' so BullMQ's own backoff/retry can pick it
 * back up (BullMQ still owns the same jobId at this point, so no new job
 * needs to be created).
 */
export async function recordEmailJobFailure(
  id: string,
  errorMessage: string,
  final: boolean,
): Promise<void> {
  await db
    .update(emailJobs)
    .set({
      status: final ? 'failed' : 'scheduled',
      errorMessage,
      attempts: sql`${emailJobs.attempts} + 1`,
    })
    .where(eq(emailJobs.id, id));
}

/**
 * Used when the reactive hourly rate-limit check rejects a claimed job:
 * the row goes back to 'scheduled' at a new (later) time, and the BullMQ
 * job id that will be responsible for waking it up next is recorded so
 * reconciliation can find the right job.
 */
export async function rescheduleEmailJob(
  id: string,
  newScheduledTime: Date,
  newBullmqJobId: string,
): Promise<void> {
  await db
    .update(emailJobs)
    .set({ status: 'scheduled', scheduledTime: newScheduledTime, bullmqJobId: newBullmqJobId })
    .where(eq(emailJobs.id, id));
}

export async function setBullmqJobId(id: string, bullmqJobId: string): Promise<void> {
  await db.update(emailJobs).set({ bullmqJobId }).where(eq(emailJobs.id, id));
}

/**
 * Recovery path for a row stuck in 'processing' because the worker that
 * claimed it crashed before finishing. Returns it to 'scheduled' with an
 * immediate scheduled_time and a fresh BullMQ job id to be woken up by.
 */
export async function recoverStaleProcessingJob(
  id: string,
  newScheduledTime: Date,
  newBullmqJobId: string,
): Promise<void> {
  await db
    .update(emailJobs)
    .set({ status: 'scheduled', scheduledTime: newScheduledTime, bullmqJobId: newBullmqJobId })
    .where(eq(emailJobs.id, id));
}

/** Rows the reconciliation pass must verify still have a live BullMQ job. */
export async function findScheduledEmailJobs(): Promise<EmailJob[]> {
  return db.select().from(emailJobs).where(eq(emailJobs.status, 'scheduled'));
}

/** Rows possibly abandoned mid-send by a crashed worker process. */
export async function findStaleProcessingEmailJobs(staleBefore: Date): Promise<EmailJob[]> {
  return db
    .select()
    .from(emailJobs)
    .where(and(eq(emailJobs.status, 'processing'), lt(emailJobs.updatedAt, staleBefore)));
}

export interface ListEmailJobsForUserOptions {
  userId: string;
  statuses?: Array<EmailJob['status']>;
  limit?: number;
  offset?: number;
}

/** Scoped join so a user can only ever see their own campaigns' jobs. */
export async function listEmailJobsForUser(
  opts: ListEmailJobsForUserOptions,
): Promise<Array<EmailJob & { campaignSubject: string }>> {
  const conditions = [eq(campaigns.userId, opts.userId)];
  if (opts.statuses && opts.statuses.length > 0) {
    conditions.push(inArray(emailJobs.status, opts.statuses));
  }

  const rows = await db
    .select({
      id: emailJobs.id,
      campaignId: emailJobs.campaignId,
      recipientEmail: emailJobs.recipientEmail,
      status: emailJobs.status,
      scheduledTime: emailJobs.scheduledTime,
      sentAt: emailJobs.sentAt,
      errorMessage: emailJobs.errorMessage,
      attempts: emailJobs.attempts,
      bullmqJobId: emailJobs.bullmqJobId,
      createdAt: emailJobs.createdAt,
      updatedAt: emailJobs.updatedAt,
      campaignSubject: campaigns.subject,
    })
    .from(emailJobs)
    .innerJoin(campaigns, eq(emailJobs.campaignId, campaigns.id))
    .where(and(...conditions))
    .orderBy(emailJobs.scheduledTime)
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0);

  return rows;
}

export async function findEmailJobForUser(
  id: string,
  userId: string,
): Promise<EmailJob | undefined> {
  const [row] = await db
    .select({ emailJobs })
    .from(emailJobs)
    .innerJoin(campaigns, eq(emailJobs.campaignId, campaigns.id))
    .where(and(eq(emailJobs.id, id), eq(campaigns.userId, userId)))
    .limit(1);
  return row?.emailJobs;
}
