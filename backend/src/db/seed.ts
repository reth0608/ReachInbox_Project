import { db, pool } from './client';
import { senders } from './schema';
import { createTestSenderCredentials } from '../services/mailer';
import { env } from '../config/env';
import { logger } from '../utils/logger';

async function main() {
  let smtpUser = env.ETHEREAL_USER;
  let smtpPass = env.ETHEREAL_PASS;

  if (!smtpUser || !smtpPass) {
    logger.info('No ETHEREAL_USER/PASS set, provisioning a fresh Ethereal test account...');
    const account = await createTestSenderCredentials();
    smtpUser = account.user;
    smtpPass = account.pass;
    logger.info(
      { user: smtpUser, pass: smtpPass },
      'Provisioned Ethereal account - copy these into backend/.env as ETHEREAL_USER / ETHEREAL_PASS to reuse them next time',
    );
  }

  const [sender] = await db
    .insert(senders)
    .values({
      name: 'Default Sender',
      smtpUser,
      smtpPass,
      smtpHost: 'smtp.ethereal.email',
      smtpPort: 587,
    })
    .returning();

  logger.info({ senderId: sender.id, name: sender.name }, 'Seeded default sender');
  await pool.end();
}

main().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});
