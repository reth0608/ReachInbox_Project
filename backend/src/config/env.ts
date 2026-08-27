import 'dotenv/config';
import { z } from 'zod';

/**
 * All runtime configuration is validated once, at process start.
 * If anything required is missing/invalid, the process fails fast with a
 * clear error instead of surfacing a confusing failure deep in the app.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  NEXTAUTH_SECRET: z.string().optional(),

  // Fallback SMTP credentials used only if a sender row has none configured.
  ETHEREAL_USER: z.string().optional(),
  ETHEREAL_PASS: z.string().optional(),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(2000),
  PROCESSING_STALE_TIMEOUT_MS: z.coerce.number().int().positive().default(2 * 60 * 1000),
  RECONCILIATION_ON_STARTUP: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  CORS_ORIGIN: z.string().default('http://localhost:3000'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
