import { Application, Request, Response } from 'express';
import { runPrompt } from '../../services/prompt-runner.js';

/** Prompt Runner: run a curated writing-craft prompt against supplied content. */
export function mountPrompts(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  app.post('/api/prompts/run', async (req: Request, res: Response) => {
    const { prompt, content, bookSlug } = req.body ?? {};
    if (typeof prompt !== 'string' || !prompt) return res.status(400).json({ error: 'prompt required' });
    if (typeof content !== 'string' || !content.trim()) return res.status(400).json({ error: 'content required' });
    if (content.length > 100000) return res.status(400).json({ error: 'content too long (max 100k chars)' });
    try {
      const out = await runPrompt(
        { prompts: { get: (n: string) => services.library.get('prompt', n)?.prompt ?? null }, aiRouter: services.aiRouter, costs: services.costs },
        prompt, content, typeof bookSlug === 'string' ? bookSlug : undefined,
      );
      if (out === null) return res.status(404).json({ error: 'Unknown prompt' });
      res.json({ output: out.text });
    } catch (err: any) {
      res.status(500).json({ error: 'Prompt run failed: ' + String(err?.message || err) });
    }
  });
}
