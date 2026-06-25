import { Application, Request, Response } from 'express';
import { SLUG_RE } from '../../services/book-types.js';
import { renderConsistencyReport } from '../../services/reports/render-consistency.js';

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
      // `running` lets a reconnecting client rehydrate the in-progress UI instead
      // of offering to start a second (ledger-corrupting) run.
      res.json({
        report: services.consistencyStore?.getReport(slug) ?? null,
        running: gateway.consistencyJobs.isRunning(slug),
        job: gateway.consistencyJobs.get(slug),
      });
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

      // Concurrency guard: a second audit for the same book while one is in
      // flight would interleave with the leading clearBookFacts() and corrupt
      // the ledger. Claim the slot atomically; reject if already running.
      if (!gateway.consistencyJobs.start(slug)) {
        return res.status(409).json({
          error: 'A consistency audit is already running for this book',
          running: gateway.consistencyJobs.get(slug),
        });
      }

      gateway.activityLog?.log({
        type: 'step_started',
        source: 'internal',
        message: `Consistency audit started for "${slug}"`,
        metadata: { book: slug },
      });

      // Respond immediately; audit runs in the background
      res.json({ status: 'started', slug });

      services.consistencyAudit(
        slug,
        (msg: string) => {
          gateway.consistencyJobs.progress(slug, msg);
          try { (gateway as any).io?.emit?.('consistency-progress', { slug, message: msg }); } catch {}
        }
      ).then((report: any) => {
        gateway.activityLog?.log({
          type: 'step_completed',
          source: 'internal',
          message: `Consistency audit complete for "${slug}": ${report?.chaptersScanned ?? 0} chapters, ${report?.findings?.length ?? 0} findings`,
          metadata: { book: slug, chaptersScanned: report?.chaptersScanned, findings: report?.findings?.length, factCount: report?.factCount },
        });
        // Emit a downloadable report (fail-soft: must not break the audit).
        try {
          const r = renderConsistencyReport(report);
          services.reports?.write(slug, 'consistency', { title: r.title, markdown: r.markdown, json: report, summary: r.summary });
        } catch { /* report emission is best-effort */ }
        try { (gateway as any).io?.emit?.('consistency-complete', { slug, report }); } catch {}
      }).catch((err: any) => {
        gateway.activityLog?.log({
          type: 'step_failed',
          source: 'internal',
          message: `Consistency audit failed for "${slug}": ${err?.message ?? String(err)}`,
          metadata: { book: slug },
        });
        try { (gateway as any).io?.emit?.('consistency-error', { slug, error: err?.message ?? String(err) }); } catch {}
      }).finally(() => {
        gateway.consistencyJobs.finish(slug);
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}
