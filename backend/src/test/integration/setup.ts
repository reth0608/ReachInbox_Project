import { db, pool } from '../../db/client';
import { users, senders, campaigns, emailJobs } from '../../db/schema';
import { emailQueue } from '../../queue/queue';
import { redis } from '../../queue/redisClient';

/**
 * These tests exercise the real Postgres schema and a real Redis/BullMQ
 * instance rather than mocks - they need DATABASE_URL and REDIS_URL
 * pointing at live services (docker-compose provides both; see README).
 * They are kept separate from the pure-logic unit tests
 * (`npm test` vs `npm run test:integration`) precisely because they need
 * that live infrastructure.
 */
export async function resetDatabase(): Promise<void> {
  await db.delete(emailJobs);
  await db.delete(campaigns);
  await db.delete(senders);
  await db.delete(users);
}

export async function seedTestUser() {
  const [user] = await db
    .insert(users)
    .values({ googleId: `test-google-${Date.now()}-${Math.random()}`, email: 'test@example.com', name: 'Test User' })
    .returning();
  return user;
}

export async function seedTestSender() {
  const [sender] = await db
    .insert(senders)
    .values({
      name: 'Test Sender',
      smtpUser: 'test@ethereal.email',
      smtpPass: 'testpass',
      smtpHost: 'smtp.ethereal.email',
      smtpPort: 587,
    })
    .returning();
  return sender;
}

export async function closeAll(): Promise<void> {
  await emailQueue.obliterate({ force: true }).catch(() => undefined);
  await emailQueue.close();
  await redis.quit();
  await pool.end();
}
