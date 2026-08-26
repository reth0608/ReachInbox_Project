import { z } from 'zod';

const MAX_RECIPIENTS = 50_000;

export const createCampaignSchema = z.object({
  subject: z.string().trim().min(1, 'subject is required').max(500),
  body: z.string().min(1, 'body is required'),
  senderId: z.string().uuid('senderId must be a valid UUID'),
  startTime: z
    .string()
    .datetime({ offset: true })
    .or(z.string().datetime())
    .transform((v) => new Date(v))
    .refine((d) => !Number.isNaN(d.getTime()), 'startTime is not a valid date'),
  delayBetweenEmailsMs: z
    .number({ invalid_type_error: 'delayBetweenEmailsMs must be a number' })
    .int()
    .min(0, 'delayBetweenEmailsMs cannot be negative'),
  hourlyLimit: z
    .number({ invalid_type_error: 'hourlyLimit must be a number' })
    .int()
    .min(1, 'hourlyLimit must be at least 1'),
  recipients: z
    .array(z.string().trim().email('one or more recipient addresses are invalid'))
    .min(1, 'campaign must include at least one recipient')
    .max(MAX_RECIPIENTS, `campaign cannot exceed ${MAX_RECIPIENTS} recipients`),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const listEmailJobsQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()) : undefined))
    .pipe(z.array(z.enum(['scheduled', 'processing', 'sent', 'failed'])).optional()),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
