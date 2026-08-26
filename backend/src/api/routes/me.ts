import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getMe } from '../controllers/meController';

export const meRouter = Router();

meRouter.get('/', asyncHandler(getMe));
