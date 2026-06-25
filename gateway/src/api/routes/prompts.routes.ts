import { Application, Request, Response } from 'express';
import { runPrompt } from '../../services/prompt-runner.js';
import { SLUG_RE } from '../../services/book-types.js';
import { validateModelSelection } from '../../services/consistency/model-selection.js';
import { renderPromptRunReport } from '../../services/reports/render-prompt-run.js';

// A prompt_run has a 16k-token output budget; allow comfortably more than the
// 100k input cap so a legitimate large completion can still be saved as a report.
const REPORT_OUTPUT_MAX = 500000;

/** Prompt Runner: run a curated writing-craft prompt against supplied content. */
export function mountPrompts(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  app.post('/api/prompts/run', async (req: Request, res: Response) => {
    const { prompt, content, bookSlug } = req.body ?? {};
    if (typeof prompt !== 'string' || !prompt) return res.status(400).json({ error: 'prompt required' });
    if (typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: 'content required' });
    if (content.length > 100000) return res.status(400).json({ error: 'content too long (max 100k chars)' });
    // Optional per-run model override.
    const selErr = validateModelSelection(req.body);
    if (selErr) return res.status(400).json({ error: selErr });
    const provider = req.body?.provider;
    const model = req.body?.model;
    try {
      const out = await runPrompt(
        { prompts: { get: (n: string) => services.library.get('prompt', n)?.prompt ?? null }, aiRouter: services.aiRouter, costs: services.costs },
        prompt, content, typeof bookSlug === 'string' ? bookSlug : undefined,
        { provider: typeof provider === 'string' ? provider : undefined, model: typeof model === 'string' ? model : undefined },
      );
      if (out === null) return res.status(404).json({ error: 'Unknown prompt' });
      res.json({ output: out.text, meta: out.meta });
    } catch (err: any) {
      res.status(500).json({ error: 'Prompt run failed: ' + String(err?.message || err) });
    }
  });

  // Save a prompt-run output as a downloadable report (prompt-run kind).
  app.post('/api/books/:slug/prompts/report', async (req: Request, res: Response) => {
    try {
      const slug = String(req.params.slug);
      if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) {
        return res.status(404).json({ error: 'Book not found' });
      }
      const { prompt, file, output, meta } = req.body ?? {};
      if (typeof output !== 'string' || !output.trim()) return res.status(400).json({ error: 'output required' });
      if (output.length > REPORT_OUTPUT_MAX) return res.status(400).json({ error: `output too long (max ${REPORT_OUTPUT_MAX} chars)` });
      if (!services.reports) return res.status(503).json({ error: 'Reports unavailable' });
      // Coerce once so the .md (rendered) and .json (persisted) describe the same inputs.
      const input = {
        prompt: typeof prompt === 'string' ? prompt : 'prompt',
        file: typeof file === 'string' ? file : '(unknown)',
        output,
        meta: meta && typeof meta === 'object' ? meta : undefined,
      };
      const r = renderPromptRunReport(input);
      const written = services.reports.write(slug, 'prompt-run', { title: r.title, markdown: r.markdown, json: input, summary: r.summary });
      if (!written) return res.status(500).json({ error: 'Failed to write report' });
      res.json({ id: written.id });
    } catch (err: any) {
      res.status(500).json({ error: 'Save report failed: ' + String(err?.message || err) });
    }
  });
}
