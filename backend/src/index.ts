import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './utils/logger';
import { requireAuth } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';
import { campaignsRouter } from './api/routes/campaigns';
import { emailJobsRouter } from './api/routes/emailJobs';
import { sendersRouter } from './api/routes/senders';
import { meRouter } from './api/routes/me';
import { healthRouter } from './api/routes/health';
import { runReconciliation } from './services/reconciliation';
import { closeEmailQueue } from './queue/queue';
import { pool } from './db/client';

const app = express();

app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '5mb' })); // large CSV recipient lists can produce sizeable payloads
app.use(pinoHttp({ logger }));

app.use('/health', healthRouter);
app.use('/api/me', requireAuth, meRouter);
app.use('/api/senders', requireAuth, sendersRouter);
app.use('/api/campaigns', requireAuth, campaignsRouter);
app.use('/api/email-jobs', requireAuth, emailJobsRouter);

app.use(errorHandler);

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

  async function shutdown(signal: string) {
    logger.info({ signal }, 'shutting down API server');
    server.close();
    await closeEmailQueue();
    await pool.end();
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'failed to start API server');
  process.exit(1);
});
