import { Application, Request, Response } from 'express';
import { SLUG_RE } from '../../services/book-types.js';

/**
 * Consistency Auditor API (consistency-auditor plan Task 5).
 * GET  /api/books/:slug/consistency-report  — return stored report (or null)
 * POST /api/books/:slug/consistency-audit   — kick off async audit, emit socket events
 */
export function mountConsistency(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  // Return the stored consistency report for a book (null if not yet run)
  app.get('/api/books/:slug/consistency-report', async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) {
        return res.status(404).json({ error: 'Book not found' });
      }
      if (!services.consistencyStore?.isAvailable()) {
        return res.status(503).json({ error: 'Consistency DB unavailable' });
      }
      res.json({ report: services.consistencyStore?.getReport(slug) ?? null });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Run consistency audit asynchronously; respond immediately and stream progress via socket
  app.post('/api/books/:slug/consistency-audit', async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) {
        return res.status(404).json({ error: 'Book not found' });
      }
      if (!services.consistencyStore?.isAvailable()) {
        return res.status(503).json({ error: 'Consistency DB unavailable' });
      }

      // Respond immediately; audit runs in the background
      res.json({ status: 'started', slug });

      services.consistencyAudit(
        slug,
        (msg: string) => {
          try { (gateway as any).io?.emit?.('consistency-progress', { slug, message: msg }); } catch {}
        }
      ).then((report: any) => {
        try { (gateway as any).io?.emit?.('consistency-complete', { slug, report }); } catch {}
      }).catch((err: any) => {
        try { (gateway as any).io?.emit?.('consistency-error', { slug, error: err?.message ?? String(err) }); } catch {}
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}
