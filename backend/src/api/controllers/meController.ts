import type { Request, Response } from 'express';
import { findUserById } from '../../db/repositories/usersRepository';
import type { AuthenticatedRequest } from '../../middleware/auth';
import { HttpError } from '../../middleware/errorHandler';

export async function getMe(req: Request, res: Response): Promise<void> {
  const { userId } = req as AuthenticatedRequest;
  const user = await findUserById(userId);
  if (!user) {
    throw new HttpError(404, 'User not found');
  }
  res.json({
    user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
  });
}
