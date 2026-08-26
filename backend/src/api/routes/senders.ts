import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getSenders } from '../controllers/sendersController';

export const sendersRouter = Router();

sendersRouter.get('/', asyncHandler(getSenders));
