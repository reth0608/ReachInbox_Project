import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { pool } from '../../db/client';
import { redis } from '../../queue/redisClient';

export const healthRouter = Router();

healthRouter.get('/', asyncHandler(async (_req, res) => {
  const [dbOk, redisOk] = await Promise.all([
    pool
      .query('SELECT 1')
      .then(() => true)
      .catch(() => false),
    redis
      .ping()
      .then(() => true)
      .catch(() => false),
  ]);

  const healthy = dbOk && redisOk;
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', db: dbOk, redis: redisOk });
}));
