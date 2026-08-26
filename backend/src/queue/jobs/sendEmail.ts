import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { childLogger } from '../../utils/logger';
import { findEmailJobById, tryClaimEmailJobForProcessing, markEmailJobSent, recordEmailJobFailure, rescheduleEmailJob } from '../../db/repositories/emailJobsRepository';
import { findCampaignByIdUnscoped } from '../../db/repositories/campaignsRepository';
import { findSenderById } from '../../db/repositories/sendersRepository';
import { checkAndIncrementHourlyLimit, releaseHourlyLimitSlot } from '../../services/rateLimiter';
import { sendEmail, MailerError } from '../../services/mailer';
import { scheduleEmailJob, type EmailJobPayload } from '../queue';

const log = childLogger('sendEmailJob');

/**
 * Processes exactly one email_jobs row. Designed so that ANY of the
 * following can happen safely, any number of times, in any order across
 * any number of worker processes, without ever sending the same email
 * twice:
 *   - the same BullMQ job is delivered more than once (BullMQ's at-least-
 *     once delivery guarantee),
 *   - reconciliation re-adds a job that was already queued,
 *   - two workers somehow pick up jobs referencing the same row.
 */
export async function processSendEmailJob(job: Job<EmailJobPayload>, redis: Redis): Promise<void> {
  const { emailJobId } = job.data;
  const jobLog = log.child({ emailJobId, bullJobId: job.id });

  const row = await findEmailJobById(emailJobId);
  if (!row) {
    // The row was deleted (e.g. cascaded from a deleted campaign). Nothing
    // to do - this is a valid no-op, not an error.
    jobLog.warn('email_jobs row no longer exists, skipping');
    return;
  }

  if (row.status !== 'scheduled') {
    // Already sent, already failed permanently, or already being processed
    // by another in-flight attempt. Whichever it is, this delivery of the
    // BullMQ job has nothing useful to do.
    jobLog.info({ status: row.status }, 'row not in scheduled state, skipping as duplicate/stale trigger');
    return;
  }

  const claimed = await tryClaimEmailJobForProcessing(emailJobId);
  if (!claimed) {
    // Another attempt claimed it between our read and our claim attempt.
    jobLog.info('lost the claim race, skipping');
    return;
  }

  const campaign = await findCampaignByIdUnscoped(row.campaignId);
  if (!campaign) {
    await recordEmailJobFailure(emailJobId, 'Parent campaign no longer exists', true);
    return;
  }

  const sender = await findSenderById(campaign.senderId);
  if (!sender) {
    await recordEmailJobFailure(emailJobId, 'Sender configuration no longer exists', true);
    return;
  }

  // Reactive safety net: the proactive scheduler already spaced this batch
  // out, but a *different* campaign sharing the same sender could have
  // consumed capacity in this exact hour window since then. Only checked
  // now, after we've won the DB claim, so a job that loses the claim race
  // never burns a rate-limit slot for a send someone else is making.
  const rateLimit = await checkAndIncrementHourlyLimit(
    redis,
    campaign.senderId,
    campaign.hourlyLimit,
  );

  if (!rateLimit.allowed) {
    // BullMQ disallows ':' in custom job ids (it uses that as an internal
    // Redis key delimiter), so a '-' separator is used instead.
    const newBullmqJobId = `${row.id}-r${randomUUID().slice(0, 8)}`;
    await rescheduleEmailJob(emailJobId, rateLimit.nextWindowStart, newBullmqJobId);
    await scheduleEmailJob({
      jobId: newBullmqJobId,
      emailJobId,
      scheduledTime: rateLimit.nextWindowStart,
    });
    jobLog.info(
      { nextWindowStart: rateLimit.nextWindowStart, newBullmqJobId },
      'hourly limit reached for sender, rescheduled to next window',
    );
    // This BullMQ job execution completes successfully as a no-op - the
    // email was never dropped or failed, just deferred.
    return;
  }

  try {
    await sendEmail({
      sender,
      to: row.recipientEmail,
      subject: campaign.subject,
      html: campaign.body,
    });
    await markEmailJobSent(emailJobId, new Date());
    jobLog.info('email sent successfully');
  } catch (err) {
    // We already consumed an hourly slot for this attempt; since it didn't
    // actually go out, give that slot back so a transient SMTP hiccup
    // doesn't permanently cost the sender real send capacity.
    await releaseHourlyLimitSlot(redis, campaign.senderId);

    const attemptsMade = job.attemptsMade ?? 1;
    const maxAttempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
    const isFinalAttempt = attemptsMade >= maxAttempts;
    const message = err instanceof MailerError ? err.message : 'Unknown send error';

    await recordEmailJobFailure(emailJobId, message, isFinalAttempt);
    jobLog.error({ err, isFinalAttempt, attemptsMade, maxAttempts }, 'send attempt failed');

    // Rethrow so BullMQ's own attempts/backoff bookkeeping stays accurate;
    // our DB write above is what actually determines the row's visible
    // status regardless of what BullMQ does with this job internally.
    throw err;
  }
}
