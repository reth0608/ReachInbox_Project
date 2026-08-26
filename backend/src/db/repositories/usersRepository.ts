import { eq } from 'drizzle-orm';
import { db } from '../client';
import { users, type User } from '../schema';

export interface GoogleProfile {
  googleId: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
}

/**
 * Upserts a user row keyed by the verified Google subject id. This is the
 * *only* place a user_id is ever derived — always from a verified identity,
 * never trusted from client-supplied request bodies.
 */
export async function upsertUserByGoogleId(profile: GoogleProfile): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      googleId: profile.googleId,
      email: profile.email,
      name: profile.name ?? null,
      avatarUrl: profile.avatarUrl ?? null,
    })
    .onConflictDoUpdate({
      target: users.googleId,
      set: {
        email: profile.email,
        name: profile.name ?? null,
        avatarUrl: profile.avatarUrl ?? null,
      },
    })
    .returning();

  return row;
}

export async function findUserById(id: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}
