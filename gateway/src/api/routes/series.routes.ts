import { Application, Request, Response } from 'express';
import { requireApprovedConfirmation } from './_shared.js';
import { SLUG_RE } from '../../services/book-types.js';
import { seriesDivergence, type SeriesRef } from '../../services/series-bible.js';

/**
 * Series API (Series Phase A — book-centric). CRUD + library asset refs + book
 * membership + continuity report (repointed to books) + divergence + the
 * confirmation-gated "pull series assets into book". Behind the same bearer-auth
 * + IP allowlist as the rest of /api/*.
 */
export function mountSeries(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();
  const REF_KINDS = ['author', 'voice', 'genre', 'pipeline'] as const;

  /** Resolve a ref input (name string | {name} | null) to a SeriesRef using the library for source. */
  const resolveRef = (kind: string, val: unknown): SeriesRef | null | undefined => {
    if (val === null) return null;
    const name = typeof val === 'string' ? val : (val && typeof val === 'object' ? (val as any).name : undefined);
    if (typeof name !== 'string' || !name) return undefined;
    const source = services.library?.get?.(kind, name)?.source ?? 'workspace';
    return { name, source };
  };

  app.get('/api/series', (_req: Request, res: Response) => {
    const sb = services.seriesBible;
    res.json({ series: sb ? sb.listSeries() : [] });
  });

  app.post('/api/series', async (req: Request, res: Response) => {
    const sb = services.seriesBible;
    if (!sb) return res.status(503).json({ error: 'Series service not initialized' });
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (!title) return res.status(400).json({ error: 'title (string) is required' });
    const description = typeof req.body?.description === 'string' ? req.body.description : '';
    const series = await sb.createSeries({ title, description });
    res.json({ series });
  });

  app.put('/api/series/:id/refs', async (req: Request, res: Response) => {
    const sb = services.seriesBible;
    if (!sb) return res.status(503).json({ error: 'Series service not initialized' });
    const refs: Record<string, SeriesRef | null> = {};
    for (const kind of REF_KINDS) {
      if (kind in (req.body || {})) {
        const r = resolveRef(kind, req.body[kind]);
        if (r !== undefined) refs[kind] = r;
      }
    }
    const series = await sb.setRefs(req.params.id, refs);
    if (!series) return res.status(404).json({ error: 'Series not found' });
    res.json({ series });
  });

  // Series Phase B: world-building (characters/places/lore.md) the series shares.
  app.get('/api/series/:id/worldbuilding', async (req: Request, res: Response) => {
    const sb = services.seriesBible;
    if (!sb) return res.status(503).json({ error: 'Series service not initialized' });
    if (!sb.getSeries(req.params.id)) return res.status(404).json({ error: 'Series not found' });
    res.json(await sb.getWorldbuilding(req.params.id));
  });

  app.put('/api/series/:id/worldbuilding', async (req: Request, res: Response) => {
    const sb = services.seriesBible;
    if (!sb) return res.status(503).json({ error: 'Series service not initialized' });
    if (!sb.getSeries(req.params.id)) return res.status(404).json({ error: 'Series not found' });
    const files: { characters?: string; places?: string; lore?: string } = {};
    for (const k of ['characters', 'places', 'lore'] as const) {
      if (typeof req.body?.[k] === 'string') files[k] = req.body[k];
    }
    await sb.setWorldbuilding(req.params.id, files);
    res.json(await sb.getWorldbuilding(req.params.id));
  });

  app.post('/api/series/:id/add-book', async (req: Request, res: Response) => {
    const sb = services.seriesBible;
    if (!sb) return res.status(503).json({ error: 'Series service not initialized' });
    const slug = typeof req.body?.slug === 'string' ? req.body.slug : '';
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'slug (valid book slug) is required' });
    if (!services.books?.exists?.(slug)) return res.status(404).json({ error: 'Book not found' });
    const series = await sb.addBook(req.params.id, slug);
    if (!series) return res.status(404).json({ error: 'Series not found' });
    res.json({ series });
  });

  app.post('/api/series/:id/remove-book', async (req: Request, res: Response) => {
    const sb = services.seriesBible;
    if (!sb) return res.status(503).json({ error: 'Series service not initialized' });
    const slug = typeof req.body?.slug === 'string' ? req.body.slug : '';
    if (!slug) return res.status(400).json({ error: 'slug is required' });
    const series = await sb.removeBook(req.params.id, slug);
    if (!series) return res.status(404).json({ error: 'Series not found' });
    res.json({ series });
  });

  app.post('/api/series/:id/reading-order', async (req: Request, res: Response) => {
    const sb = services.seriesBible;
    if (!sb) return res.status(503).json({ error: 'Series service not initialized' });
    const order = Array.isArray(req.body?.order) ? req.body.order.filter((s: unknown) => typeof s === 'string') : null;
    if (!order) return res.status(400).json({ error: 'order (array of book slugs) is required' });
    const series = await sb.setReadingOrder(req.params.id, order);
    if (!series) return res.status(404).json({ error: 'Series not found' });
    res.json({ series });
  });

  app.get('/api/series/:id/report', async (req: Request, res: Response) => {
    const sb = services.seriesBible;
    const ctxEngine = services.contextEngine;
    const engine = gateway.getProjectEngine?.();
    if (!sb || !ctxEngine || !engine) return res.status(503).json({ error: 'Series services not initialized' });
    try {
      const titleOf = (pid: string) => engine.getProject(pid)?.title;
      const projectsForBook = (slug: string) => engine.listProjects().filter((p: any) => p.bookSlug === slug).map((p: any) => p.id);
      const report = await sb.buildReport(req.params.id, ctxEngine, titleOf, projectsForBook);
      if (!report) return res.status(404).json({ error: 'Series not found' });
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });

  app.get('/api/series/:id/divergence/:slug', async (req: Request, res: Response) => {
    const sb = services.seriesBible;
    if (!sb) return res.status(503).json({ error: 'Series service not initialized' });
    const series = sb.getSeries(req.params.id);
    if (!series) return res.status(404).json({ error: 'Series not found' });
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    const opened = await services.books?.open?.(slug);
    if (!opened) return res.status(404).json({ error: 'Book not found' });
    res.json({ divergence: seriesDivergence(series.pulledFrom, opened.manifest.pulledFrom) });
  });

  // Confirmation-gated "pull series assets into book" (overwrites the book's
  // author/voice/genre[/pipeline] snapshot to match the series). No confirmationId
  // → create the request (202). With an approved confirmationId → execute.
  app.post('/api/series/:id/pull/:slug', async (req: Request, res: Response) => {
    const sb = services.seriesBible;
    if (!sb) return res.status(503).json({ error: 'Series service not initialized' });
    const series = sb.getSeries(req.params.id);
    if (!series) return res.status(404).json({ error: 'Series not found' });
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) return res.status(404).json({ error: 'Book not found' });

    const confId = typeof req.body?.confirmationId === 'string' ? req.body.confirmationId : '';
    if (!confId) {
      const conf = await services.confirmationGate.createRequest({
        service: 'series-pull', action: 'pull', platform: 'api',
        description: `Overwrite "${slug}" author/voice/genre to match series "${series.title}"`,
        payload: { seriesId: req.params.id, slug },
        riskLevel: 'high', isReversible: true, disclosures: [],
      });
      return res.status(202).json({ gated: true, confirmationId: conf.id });
    }
    const gate = requireApprovedConfirmation(services.confirmationGate, { id: confId, expectedService: 'series-pull' });
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    if (gate.request.payload?.slug !== slug || gate.request.payload?.seriesId !== req.params.id) {
      return res.status(400).json({ error: 'confirmation does not match this series/book' });
    }
    try {
      const wb = await sb.getWorldbuilding(req.params.id);
      await services.books.applySeriesAssets(slug, series.pulledFrom, wb);
      await services.confirmationGate.recordOutcome(confId, { success: true, message: `Pulled series assets into ${slug}`, executedAt: new Date().toISOString() });
      res.json({ pulled: slug });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });

  app.delete('/api/series/:id', async (req: Request, res: Response) => {
    const sb = services.seriesBible;
    if (!sb) return res.status(503).json({ error: 'Series service not initialized' });
    const removed = await sb.deleteSeries(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Series not found' });
    res.json({ success: true });
  });
}
