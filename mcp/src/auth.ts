import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on unequal-length buffers; guard first.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function makeAuthMiddleware(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = String(req.headers['authorization'] || '');
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || !constantTimeEqual(presented, token)) {
      res.status(401).json({ error: 'Unauthorized — present a valid Bearer BOOKCLAW_MCP_TOKEN.' });
      return;
    }
    next();
  };
}
