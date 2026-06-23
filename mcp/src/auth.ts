import type { Request, Response, NextFunction } from 'express';

export function makeAuthMiddleware(token: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = String(req.headers['authorization'] || '');
    const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || presented !== token) {
      res.status(401).json({ error: 'Unauthorized — present a valid Bearer BOOKCLAW_MCP_TOKEN.' });
      return;
    }
    next();
  };
}
