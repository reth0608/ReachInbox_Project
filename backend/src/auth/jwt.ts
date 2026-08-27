import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface VerifiedGoogleClaims {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

/**
 * Verifies the short-lived HS256 bearer token minted by the frontend's
 * NextAuth session callback. This is separate from NextAuth's own internal
 * session cookie, which remains private to the Next.js app.
 */
export function verifyAccessToken(token: string): VerifiedGoogleClaims | null {
  if (!env.NEXTAUTH_SECRET) {
    throw new Error('NEXTAUTH_SECRET is required to verify API access tokens');
  }

  try {
    const decoded = jwt.verify(token, env.NEXTAUTH_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded === 'string') return null;

    const { sub, email, name, picture } = decoded as Record<string, unknown>;
    if (typeof sub !== 'string' || typeof email !== 'string') return null;

    return {
      sub,
      email,
      name: typeof name === 'string' ? name : undefined,
      picture: typeof picture === 'string' ? picture : undefined,
    };
  } catch {
    return null;
  }
}
