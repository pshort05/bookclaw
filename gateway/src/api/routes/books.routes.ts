import { Application, Request, Response } from 'express';

/**
 * Books API (book-container Phase 2). Read + create. No edit/delete yet (Phase 4).
 * Behind the same bearer-auth + IP allowlist as the rest of /api/*.
 */
export function mountBooks(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  app.get('/api/books', (_req: Request, res: Response) => {
    res.json({ books: services.books.list() });
  });

  app.get('/api/books/active', async (_req: Request, res: Response) => {
    const slug = services.books.getActiveBook();
    if (!slug) return res.json({ active: null });
    const result = await services.books.open(slug);
    if (!result) return res.json({ active: null });
    res.json({ active: { slug, book: result.manifest, status: result.status } });
  });

  app.post('/api/books/active', async (req: Request, res: Response) => {
    const slug = typeof req.body?.slug === 'string' ? req.body.slug : '';
    if (!slug) return res.status(400).json({ error: 'slug (string) is required' });
    try {
      await services.books.setActiveBook(slug);
      // Re-point the Author identity to the newly-active book (Phase 3b).
      const authorDir = services.books.activeAuthorDir();
      if (authorDir && gateway.soul) await gateway.soul.useBook(authorDir);
      res.json({ success: true, active: slug });
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      res.status(/unknown/i.test(msg) ? 404 : 500).json({ error: msg });
    }
  });

  app.get('/api/books/:slug', async (req: Request, res: Response) => {
    const result = await services.books.open(String(req.params.slug));
    if (!result) return res.status(404).json({ error: 'Book not found' });
    res.json({ book: result.manifest, status: result.status });
  });

  app.post('/api/books', async (req: Request, res: Response) => {
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return res.status(400).json({ error: 'title (string) is required' });
    if (typeof body.author !== 'string' || !body.author) return res.status(400).json({ error: 'author (string) is required' });
    if (typeof body.pipeline !== 'string' || !body.pipeline) return res.status(400).json({ error: 'pipeline (string) is required' });
    const genre = (typeof body.genre === 'string' && body.genre) ? body.genre : null;
    const sections = Array.isArray(body.sections) ? body.sections.filter((s: unknown) => typeof s === 'string') : [];
    try {
      const manifest = await services.books.create({ title, author: body.author, genre, pipeline: body.pipeline, sections });
      res.json({ success: true, book: manifest });
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      res.status(/unknown|required/i.test(msg) ? 400 : 500).json({ error: msg });
    }
  });
}
