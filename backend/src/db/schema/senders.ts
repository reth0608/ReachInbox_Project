import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const senders = pgTable('senders', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  smtpUser: text('smtp_user').notNull(),
  smtpPass: text('smtp_pass').notNull(),
  smtpHost: text('smtp_host').notNull().default('smtp.ethereal.email'),
  smtpPort: integer('smtp_port').notNull().default(587),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Sender = typeof senders.$inferSelect;
export type NewSender = typeof senders.$inferInsert;
