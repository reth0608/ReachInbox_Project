import type { Request, Response, NextFunction, RequestHandler } from 'express';

/** Wraps an async Express handler so a rejected promise reaches errorHandler. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
