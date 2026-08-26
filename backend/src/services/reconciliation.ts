import {
  findScheduledEmailJobs,
  findStaleProcessingEmailJobs,
  setBullmqJobId,
  recoverStaleProcessingJob,
} from '../db/repositories/emailJobsRepository';
import { scheduleEmailJob, getEmailQueueJob } from '../queue/queue';
import { env } from '../config/env';
import { childLogger } from '../utils/logger';

const log = childLogger('reconciliation');

export interface ReconciliationResult {
  scheduledChecked: number;
  recreated: number;
  staleProcessingRecovered: number;
}

/**
 * Runs once on API startup (see index.ts). PostgreSQL is the source of
 * truth, so this pass exists purely to repair Redis/BullMQ state to match
 * it - it never needs to trust or verify anything BullMQ says beyond
 * "does a job with this id currently exist".
 *
 * Two independent problems are handled:
 *
 *  1. A 'scheduled' row with no live BullMQ job. Normally impossible
 *     (BullMQ jobs persist in Redis across app restarts via AOF), but this
 *     is the defense-in-depth layer for the edge cases where it happens
 *     anyway - Redis was flushed, the enqueue step after a campaign's DB
 *     transaction committed never completed, etc.
 *
 *  2. A 'processing' row whose worker crashed mid-send, leaving it stuck
 *     forever with no BullMQ job left to wake anything up (the job that
 *     was processing it either completed-with-no-op-you'd-never-see or
 *     simply vanished with the crashed process). Detected via a staleness
 *     timeout on updated_at.
 */
export async function runReconciliation(): Promise<ReconciliationResult> {
  const scheduledRows = await findScheduledEmailJobs();
  let recreated = 0;

  for (const row of scheduledRows) {
    const jobId = row.bullmqJobId ?? row.id;
    const existingJob = await getEmailQueueJob(jobId);

    if (!existingJob) {
      await scheduleEmailJob({ jobId, emailJobId: row.id, scheduledTime: row.scheduledTime });
      if (!row.bullmqJobId) {
        await setBullmqJobId(row.id, jobId);
      }
      recreated++;
      log.warn(
        { emailJobId: row.id, jobId, scheduledTime: row.scheduledTime },
        'recreated missing BullMQ job for scheduled row',
      );
    }
  }

  const staleBefore = new Date(Date.now() - env.PROCESSING_STALE_TIMEOUT_MS);
  const staleRows = await findStaleProcessingEmailJobs(staleBefore);
  let staleProcessingRecovered = 0;

  for (const row of staleRows) {
    // BullMQ disallows ':' in custom job ids - see jobs/sendEmail.ts.
    const recoveryJobId = `${row.id}-recovery-${Date.now()}`;
    const now = new Date();
    await recoverStaleProcessingJob(row.id, now, recoveryJobId);
    await scheduleEmailJob({ jobId: recoveryJobId, emailJobId: row.id, scheduledTime: now });
    staleProcessingRecovered++;
    log.warn(
      { emailJobId: row.id, staleSinceUpdatedAt: row.updatedAt },
      'recovered a row stuck in processing (likely a crashed worker) back to scheduled',
    );
  }

  const result: ReconciliationResult = {
    scheduledChecked: scheduledRows.length,
    recreated,
    staleProcessingRecovered,
  };
  log.info(result, 'reconciliation pass complete');
  return result;
}
