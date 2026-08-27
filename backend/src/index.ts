import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { Worker, type Job } from 'bullmq';
import { env } from './config/env';
import { logger, childLogger } from './utils/logger';
import { requireAuth } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { campaignsRouter } from './api/routes/campaigns';
import { emailJobsRouter } from './api/routes/emailJobs';
import { sendersRouter } from './api/routes/senders';
import { meRouter } from './api/routes/me';
import { healthRouter } from './api/routes/health';
import { runReconciliation } from './services/reconciliation';
import { EMAIL_QUEUE_NAME, closeEmailQueue, type EmailJobPayload } from './queue/queue';
import { createRedisConnection, redis } from './queue/redisClient';
import { processSendEmailJob } from './queue/jobs/sendEmail';
import { pool } from './db/client';

const log = childLogger('worker');
const app = express();

app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(pinoHttp({ logger }));

app.use('/health', healthRouter);
app.use('/api/me', requireAuth, meRouter);
app.use('/api/senders', requireAuth, sendersRouter);
app.use('/api/campaigns', requireAuth, campaignsRouter);
app.use('/api/email-jobs', requireAuth, emailJobsRouter);

app.use(errorHandler);

function startWorker() {
  const worker = new Worker<EmailJobPayload>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailJobPayload>) => {
      await processSendEmailJob(job, redis);
    },
    {
      connection: createRedisConnection(),
      concurrency: env.WORKER_CONCURRENCY,
      limiter: {
        max: 1,
        duration: env.MIN_DELAY_MS,
      },
    },
  );

  worker.on('active', (job) => {
    log.debug({ jobId: job.id, emailJobId: job.data.emailJobId }, 'job started');
  });

  worker.on('completed', (job) => {
    log.debug({ jobId: job.id, emailJobId: job.data.emailJobId }, 'job completed');
  });

  worker.on('failed', (job, err) => {
    log.error(
      { jobId: job?.id, emailJobId: job?.data.emailJobId, err, attemptsMade: job?.attemptsMade },
      'job failed',
    );
  });

  worker.on('error', (err) => {
    log.error({ err }, 'worker-level error');
  });

  log.info(
    { concurrency: env.WORKER_CONCURRENCY, minDelayMs: env.MIN_DELAY_MS },
    'email worker started',
  );

  return worker;
}

async function main() {
  if (env.RECONCILIATION_ON_STARTUP) {
    try {
      await runReconciliation();
    } catch (err) {
      logger.error({ err }, 'startup reconciliation failed - continuing anyway');
    }
  }

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'API server listening');
  });

  const worker = startWorker();

  async function shutdown(signal: string) {
    logger.info({ signal }, 'shutting down API server + worker');
    server.close();
    await worker.close();
    await closeEmailQueue();
    await pool.end();
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'failed to start API + worker');
  process.exit(1);
});