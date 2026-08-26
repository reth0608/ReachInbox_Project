import { eq } from 'drizzle-orm';
import { db } from '../client';
import { senders, type Sender } from '../schema';

export async function listSenders(): Promise<Sender[]> {
  return db.select().from(senders).orderBy(senders.createdAt);
}

export async function findSenderById(id: string): Promise<Sender | undefined> {
  const [row] = await db.select().from(senders).where(eq(senders.id, id)).limit(1);
  return row;
}
