import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export interface VerifiedGoogleClaims {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

/**
 * Verifies a plain HS256 JWT signed by the frontend's NextAuth instance
 * using the shared NEXTAUTH_SECRET. NextAuth's default JWT strategy
 * produces an *encrypted* (JWE) token that only NextAuth itself can read;
 * the frontend overrides `encode`/`decode` to instead sign a standard,
 * externally-verifiable JWT so this Express backend can validate it
 * directly, without depending on Next.js at all. See frontend/lib/auth.ts.
 */
export function verifyAccessToken(token: string): VerifiedGoogleClaims | null {
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
