import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { getEmailJobs, getEmailJobById } from '../controllers/emailJobsController';

export const emailJobsRouter = Router();

emailJobsRouter.get('/', asyncHandler(getEmailJobs));
emailJobsRouter.get('/:id', asyncHandler(getEmailJobById));
