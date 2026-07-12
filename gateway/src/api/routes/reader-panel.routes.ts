import { Application, Request, Response } from 'express';
import type { PanelKind } from '../../services/reader-panel.js';

/**
 * Reader-Panel API — ranks candidate marketing copy (blurb/hook/title/opening)
 * against a panel of reader personas with anti-slop guards.
 * POST /api/reader-panel/run — run the panel, return a PanelReport.
 * Mounted from routes.ts; the `readerPanel` service is built in phase-07 and
 * exposed via getServices().
 */
const ALLOWED_KINDS: PanelKind[] = ['blurb', 'hook', 'title', 'opening'];

export function mountReaderPanel(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  app.post('/api/reader-panel/run', async (req: Request, res: Response) => {
    const svc = services.readerPanel;
    if (!svc) return res.status(503).json({ error: 'Reader panel service not initialized' });

    const { candidates, kind, personas } = req.body || {};

    if (!Array.isArray(candidates)) {
      return res.status(400).json({ error: 'candidates (string[]) required' });
    }
    // Trust-boundary caps: every candidate is inlined into one prompt, so bound
    // count and length to keep input tokens (and cost) finite on untrusted input.
    const MAX_CANDIDATES = 12;
    const MAX_CANDIDATE_CHARS = 4000;
    const clean = candidates
      .map((c: any) => String(c ?? '').trim().slice(0, MAX_CANDIDATE_CHARS))
      .filter(Boolean)
      .slice(0, MAX_CANDIDATES);
    if (clean.length === 0) {
      return res.status(400).json({ error: 'Provide at least one non-empty candidate.' });
    }

    const resolvedKind: PanelKind = ALLOWED_KINDS.includes(kind) ? kind : 'blurb';

    let resolvedPersonas: Array<{ id: string; label: string; lens: string }> | undefined;
    if (personas !== undefined) {
      if (!Array.isArray(personas)) {
        return res.status(400).json({ error: 'personas, if provided, must be an array' });
      }
      resolvedPersonas = personas
        .map((p: any) => ({
          id: typeof p?.id === 'string' ? p.id.slice(0, 200) : '',
          label: typeof p?.label === 'string' ? p.label.slice(0, 200) : '',
          lens: typeof p?.lens === 'string' ? p.lens.slice(0, 500) : '',
        }))
        .filter((p: any) => p.id && p.label && p.lens)
        .slice(0, 8);
      if (resolvedPersonas.length === 0) {
        return res.status(400).json({ error: 'personas array had no valid entries (each needs id, label, lens)' });
      }
    }

    if (!services.aiRouter) {
      return res.status(503).json({ error: 'AI router not available — a provider (Ollama/Gemini/etc.) is required to run a panel.' });
    }

    const aiComplete = (request: any) => services.aiRouter.complete(request);
    const aiSelectProvider = (taskType: string) => services.aiRouter.selectProvider(taskType);

    try {
      const report = await svc.runPanel(resolvedKind, clean, resolvedPersonas, aiComplete, aiSelectProvider);
      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Reader panel run failed' });
    }
  });
}
