import { Application, Request, Response } from 'express';
import { SLUG_RE } from '../../services/book-types.js';
import { serveFile } from './_shared.js';

/**
 * Downloadable reports API. Reports are written per-book under data/reports/ by
 * the analysis engines (consistency, beta-reader, structure, plot-promises).
 * GET  /api/books/:slug/reports          — list report metadata (newest-first)
 * GET  /api/books/:slug/reports/:id       — view/download one (?format=md|json, ?download=1)
 */
export function mountReports(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  app.get('/api/books/:slug/reports', (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) return res.status(404).json({ error: 'Book not found' });
    res.json({ reports: services.reports?.list(slug) ?? [] });
  });

  app.get('/api/books/:slug/reports/:id', (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    const id = String(req.params.id);
    const format = req.query.format === 'json' ? 'json' : 'md';
    if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) return res.status(404).json({ error: 'Book not found' });
    const p = services.reports?.resolvePath(slug, id, format);
    if (!p) return res.status(404).json({ error: 'Report not found' });
    serveFile(res, p, `${id}.${format}`, !!req.query.download).catch(() => res.destroy());
  });
}
