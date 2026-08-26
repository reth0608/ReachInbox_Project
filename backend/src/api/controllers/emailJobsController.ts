import type { Request, Response } from 'express';
import { listEmailJobsQuerySchema } from '../validation/campaignSchemas';
import { listEmailJobsForUser, findEmailJobForUser } from '../../db/repositories/emailJobsRepository';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { HttpError } from '../../middleware/errorHandler';

export async function getEmailJobs(req: Request, res: Response): Promise<void> {
  const { userId } = req as AuthenticatedRequest;
  const query = listEmailJobsQuerySchema.parse(req.query);

  const jobs = await listEmailJobsForUser({
    userId,
    statuses: query.status,
    limit: query.limit,
    offset: query.offset,
  });

  res.json({ jobs });
}

export async function getEmailJobById(req: Request, res: Response): Promise<void> {
  const { userId } = req as AuthenticatedRequest;
  const job = await findEmailJobForUser(req.params.id, userId);
  if (!job) {
    throw new HttpError(404, 'Email job not found');
  }
  res.json({ job });
}
