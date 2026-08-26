import { Worker, type Job } from 'bullmq';
import { EMAIL_QUEUE_NAME, type EmailJobPayload } from './queue/queue';
import { createRedisConnection, redis } from './queue/redisClient';
import { processSendEmailJob } from './queue/jobs/sendEmail';
import { env } from './config/env';
import { childLogger } from './utils/logger';
import { createServer } from 'node:http';

const healthPort = Number(process.env.PORT) || 8080;
createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('worker ok');
}).listen(healthPort, () => {
  log.info({ healthPort }, 'worker health endpoint listening');
});
const log = childLogger('worker');

const worker = new Worker<EmailJobPayload>(
  EMAIL_QUEUE_NAME,
  async (job: Job<EmailJobPayload>) => {
    await processSendEmailJob(job, redis);
  },
  {
    connection: createRedisConnection(),
    concurrency: env.WORKER_CONCURRENCY,
    // Global minimum spacing between dequeued jobs across the whole queue -
    // this is the "minimum delay between individual email sends" knob.
    // It is intentionally queue-wide, not per-sender; per-sender pacing is
    // handled separately by the hourly rate limiter. See README for the
    // trade-off.
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

async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down worker');
  await worker.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
