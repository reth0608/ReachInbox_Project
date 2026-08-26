import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { postCampaign, getCampaigns, getCampaignById } from '../controllers/campaignsController';

export const campaignsRouter = Router();

campaignsRouter.post('/', asyncHandler(postCampaign));
campaignsRouter.get('/', asyncHandler(getCampaigns));
campaignsRouter.get('/:id', asyncHandler(getCampaignById));
