import type { Request, Response } from 'express';
import { listSenders } from '../../db/repositories/sendersRepository';

export async function getSenders(_req: Request, res: Response): Promise<void> {
  const senders = await listSenders();
  // Never expose SMTP credentials to the frontend.
  res.json({
    senders: senders.map((s) => ({ id: s.id, name: s.name, smtpHost: s.smtpHost })),
  });
}
