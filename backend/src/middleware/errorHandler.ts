import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { childLogger } from '../utils/logger';

const log = childLogger('errorHandler');

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', details: err.flatten() });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  log.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({ error: 'Internal server error' });
}
