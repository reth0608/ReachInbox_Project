import { pgTable, uuid, text, integer, timestamp, pgEnum, index } from 'drizzle-orm/pg-core';
import { campaigns } from './campaigns';

export const emailJobStatusEnum = pgEnum('email_job_status', [
  'scheduled',
  'processing',
  'sent',
  'failed',
]);

export const emailJobs = pgTable(
  'email_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    recipientEmail: text('recipient_email').notNull(),
    status: emailJobStatusEnum('status').notNull().default('scheduled'),
    scheduledTime: timestamp('scheduled_time', { withTimezone: true }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    attempts: integer('attempts').notNull().default(0),
    bullmqJobId: text('bullmq_job_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    campaignIdx: index('email_jobs_campaign_id_idx').on(table.campaignId),
    statusScheduledIdx: index('email_jobs_status_scheduled_time_idx').on(
      table.status,
      table.scheduledTime,
    ),
    statusUpdatedIdx: index('email_jobs_status_updated_at_idx').on(table.status, table.updatedAt),
  }),
);

export type EmailJob = typeof emailJobs.$inferSelect;
export type NewEmailJob = typeof emailJobs.$inferInsert;
