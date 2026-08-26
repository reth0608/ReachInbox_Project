import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../auth/jwt';
import { upsertUserByGoogleId } from '../db/repositories/usersRepository';

export interface AuthenticatedRequest extends Request {
  userId: string;
}

/**
 * The only place a user_id ever gets attached to a request. It is always
 * derived from a cryptographically verified Google identity, never from
 * anything the client sent in a request body - so a campaign create
 * payload with a spoofed userId is simply not possible; there is no
 * userId field on that payload at all (see validation/campaignSchemas.ts).
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' });
    return;
  }

  const claims = verifyAccessToken(token);
  if (!claims) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  const user = await upsertUserByGoogleId({
    googleId: claims.sub,
    email: claims.email,
    name: claims.name ?? null,
    avatarUrl: claims.picture ?? null,
  });

  (req as AuthenticatedRequest).userId = user.id;
  next();
}
