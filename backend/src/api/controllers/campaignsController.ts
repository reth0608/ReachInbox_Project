import type { Request, Response } from 'express';
import { createCampaignSchema } from '../validation/campaignSchemas';
import { createCampaign } from '../../services/campaignService';
import { findCampaignById, listCampaignsForUser } from '../../db/repositories/campaignsRepository';
import { findSenderById } from '../../db/repositories/sendersRepository';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { HttpError } from '../../middleware/errorHandler';

export async function postCampaign(req: Request, res: Response): Promise<void> {
  const { userId } = req as AuthenticatedRequest;
  const input = createCampaignSchema.parse(req.body);

  const sender = await findSenderById(input.senderId);
  if (!sender) {
    throw new HttpError(400, `Unknown senderId: ${input.senderId}`);
  }

  const { campaign, jobs } = await createCampaign({ ...input, userId });

  res.status(201).json({
    campaign,
    jobs: jobs.map((j) => ({
      id: j.id,
      recipientEmail: j.recipientEmail,
      status: j.status,
      scheduledTime: j.scheduledTime,
    })),
    recipientCount: jobs.length,
  });
}

export async function getCampaigns(req: Request, res: Response): Promise<void> {
  const { userId } = req as AuthenticatedRequest;
  const campaigns = await listCampaignsForUser(userId);
  res.json({ campaigns });
}

export async function getCampaignById(req: Request, res: Response): Promise<void> {
  const { userId } = req as AuthenticatedRequest;
  const campaign = await findCampaignById(req.params.id, userId);
  if (!campaign) {
    throw new HttpError(404, 'Campaign not found');
  }
  res.json({ campaign });
}
