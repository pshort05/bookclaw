import { Application, Request, Response } from 'express';
import { readFileSync } from 'fs';
import { SLUG_RE } from '../../services/book-types.js';
import { runTryFailAudit } from '../../services/try-fail/audit.js';
import { renderTryFailReport } from '../../services/reports/render-try-fail.js';
import type { TryFailReport } from '../../services/try-fail/types.js';
import { validateConsistencyModelSelection, resolveConsistencyModel, consistencyCapabilityError } from '../../services/consistency/model-selection.js';

/**
 * Try-Fail & Escalation Auditor API (TODO #15). Synchronous, single-LLM-call
 * audit (modeled on plot-promises); shares the consistency model selection
 * (same large-context manuscript-analysis need).
 * POST /api/books/:slug/try-fail-audit   — run the audit, store + return the report
 * GET  /api/books/:slug/try-fail-report  — latest stored report (or null)
 */
export function mountTryFail(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  app.post('/api/books/:slug/try-fail-audit', async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) {
        return res.status(404).json({ error: 'Book not found' });
      }

      // Per-run model override (this run only). Validate before doing any work.
      const selErr = validateConsistencyModelSelection(req.body);
      if (selErr) return res.status(400).json({ error: selErr });
      const override = {
        provider: typeof req.body?.provider === 'string' ? req.body.provider : undefined,
        model: typeof req.body?.model === 'string' ? req.body.model : undefined,
      };

      const dataDir = services.books?.dataDirOf?.(slug) ?? null;
      if (!dataDir) return res.status(404).json({ error: 'Book data directory not found' });

      // Capability gate: needs a large-context (non-Ollama) provider. Resolve the
      // effective selection (per-run → per-book → auto) and confirm a capable
      // provider is configured before spending the single LLM call.
      const manifest = (await services.books.open(slug) as any)?.manifest;
      const sel = resolveConsistencyModel(override, manifest?.consistency);
      const availableIds = (services.aiRouter?.getActiveProviders?.() ?? []).map((p: any) => p.id);
      const capErr = consistencyCapabilityError(sel, availableIds);
      if (capErr) return res.status(422).json({ error: capErr });

      const report = await runTryFailAudit({
        slug,
        dataDir,
        aiComplete: (r: any) => services.aiRouter.complete(r),
        aiSelect: (t: string, p?: string) => services.aiRouter.selectProvider(t, p),
        model: sel,
      });

      // Emit a downloadable report (best-effort: must not break the audit).
      try {
        const rendered = renderTryFailReport(report);
        services.reports?.write(slug, 'try-fail', { ...rendered, json: report });
      } catch { /* report emission is best-effort */ }

      res.json(report);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get('/api/books/:slug/try-fail-report', (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) {
        return res.status(404).json({ error: 'Book not found' });
      }
      const latest = (services.reports?.list(slug) ?? []).find((m: any) => m.kind === 'try-fail');
      if (!latest) return res.json({ report: null });
      const p = services.reports?.resolvePath(slug, latest.id, 'json');
      if (!p) return res.json({ report: null });
      let report: TryFailReport | null = null;
      try {
        report = JSON.parse(readFileSync(p, 'utf-8')) as TryFailReport;
      } catch { report = null; }
      res.json({ report });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });
}
