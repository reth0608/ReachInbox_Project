import { and, desc, eq } from 'drizzle-orm';
import { db } from '../client';
import { campaigns, emailJobs, type Campaign, type EmailJob, type NewEmailJob } from '../schema';

export interface CreateCampaignInput {
  userId: string;
  subject: string;
  body: string;
  senderId: string;
  delayBetweenEmailsMs: number;
  hourlyLimit: number;
  startTime: Date;
  jobs: Array<{ recipientEmail: string; scheduledTime: Date }>;
}

export interface CreatedCampaign {
  campaign: Campaign;
  jobs: EmailJob[];
}

/**
 * Creates the campaign and every one of its email_jobs rows in a single
 * DB transaction. This is the "insert all email_jobs as scheduled" step
 * from the design - it must be all-or-nothing, since a half-written batch
 * would leave the frontend showing an inconsistent recipient count.
 *
 * BullMQ jobs are deliberately NOT created inside this transaction - queue
 * operations aren't transactional with Postgres, so they're added
 * afterwards by the caller once the DB commit has succeeded (see
 * services/campaignService.ts). If that enqueue step is interrupted, the
 * startup reconciliation pass (services/reconciliation.ts) will notice rows
 * with no corresponding BullMQ job and create them.
 */
export async function createCampaignWithJobs(input: CreateCampaignInput): Promise<CreatedCampaign> {
  return db.transaction(async (tx) => {
    const [campaign] = await tx
      .insert(campaigns)
      .values({
        userId: input.userId,
        subject: input.subject,
        body: input.body,
        senderId: input.senderId,
        delayBetweenEmailsMs: input.delayBetweenEmailsMs,
        hourlyLimit: input.hourlyLimit,
        startTime: input.startTime,
      })
      .returning();

    const newJobs: NewEmailJob[] = input.jobs.map((j) => ({
      campaignId: campaign.id,
      recipientEmail: j.recipientEmail,
      scheduledTime: j.scheduledTime,
      status: 'scheduled',
    }));

    const insertedJobs = await tx.insert(emailJobs).values(newJobs).returning();

    return { campaign, jobs: insertedJobs };
  });
}

export async function findCampaignById(
  id: string,
  userId: string,
): Promise<Campaign | undefined> {
  const [row] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, id), eq(campaigns.userId, userId)))
    .limit(1);
  return row;
}

/**
 * Unscoped lookup for internal worker/system use only (the worker isn't
 * acting on behalf of any particular HTTP-authenticated user). Never expose
 * this path to a client-facing route.
 */
export async function findCampaignByIdUnscoped(id: string): Promise<Campaign | undefined> {
  const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
  return row;
}

export async function listCampaignsForUser(userId: string): Promise<Campaign[]> {
  return db
    .select()
    .from(campaigns)
    .where(eq(campaigns.userId, userId))
    .orderBy(desc(campaigns.createdAt));
}
