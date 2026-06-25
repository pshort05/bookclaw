import { Application, Request, Response } from 'express';
import { SLUG_RE } from '../../services/book-types.js';
import { serializeWorldDoc } from '../../services/world-parse.js';
import { bindBookWorld, unbindBookWorld } from './world-bind.js';

/**
 * World Repository documents API (World Repository Phase 1). World CONFIG
 * create/edit rides the existing library API; these routes own the documents
 * (catalog/read/create+auto-classify/update/delete). Behind the same bearer
 * auth + IP allowlist as the rest of /api/*.
 *
 * Phase 3 adds the book-binding endpoints: POST /api/books/:slug/world/propose
 * (relevance-pull) and PUT /api/books/:slug/world/docs (curate + snapshot).
 */
export function mountWorlds(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  app.get('/api/worlds', (_req: Request, res: Response) => {
    const world = services.world;
    res.json({ worlds: world ? world.list() : [] });
  });

  app.get('/api/worlds/:name', (req: Request, res: Response) => {
    const world = services.world;
    if (!world) return res.status(503).json({ error: 'World service not initialized' });
    const cfg = world.getConfig(req.params.name);
    if (!cfg) return res.status(404).json({ error: 'World not found' });
    res.json({ world: cfg });
  });

  app.get('/api/worlds/:name/documents', (req: Request, res: Response) => {
    const world = services.world;
    if (!world) return res.status(503).json({ error: 'World service not initialized' });
    if (!world.getConfig(req.params.name)) return res.status(404).json({ error: 'World not found' });
    res.json({ documents: world.listDocuments(req.params.name) });
  });

  app.get('/api/worlds/:name/documents/:docId', (req: Request, res: Response) => {
    const world = services.world;
    if (!world) return res.status(503).json({ error: 'World service not initialized' });
    const doc = world.getDocument(req.params.name, req.params.docId);
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json({ document: doc });
  });

  app.post('/api/worlds/:name/documents', (req: Request, res: Response) => {
    const world = services.world;
    if (!world) return res.status(503).json({ error: 'World service not initialized' });
    const meta = req.body?.meta;
    const body = req.body?.body;
    if (!meta || typeof meta !== 'object' || typeof body !== 'string') {
      return res.status(400).json({ error: 'meta (object) and body (string) are required' });
    }
    try {
      const doc = world.createDocument(req.params.name, { meta, body });
      res.json({ document: doc });
    } catch (err) {
      res.status(400).json({ error: (err as Error)?.message || 'create failed' });
    }
  });

  app.put('/api/worlds/:name/documents/:docId', (req: Request, res: Response) => {
    const world = services.world;
    if (!world) return res.status(503).json({ error: 'World service not initialized' });
    const meta = req.body?.meta;
    const body = req.body?.body;
    if (!meta || typeof meta !== 'object' || typeof meta.classification !== 'string' || typeof body !== 'string') {
      return res.status(400).json({ error: 'meta (with classification) and body (string) are required' });
    }
    try {
      const doc = world.updateDocument(req.params.name, req.params.docId, { meta, body });
      res.json({ document: doc });
    } catch (err) {
      res.status(404).json({ error: (err as Error)?.message || 'update failed' });
    }
  });

  app.delete('/api/worlds/:name/documents/:docId', (req: Request, res: Response) => {
    const world = services.world;
    if (!world) return res.status(503).json({ error: 'World service not initialized' });
    if (!world.getConfig(req.params.name)) return res.status(404).json({ error: 'World not found' });
    // Idempotent within an existing world: deleting an already-gone doc returns
    // 200 {deleted:false} (the studio's api() throws on non-2xx, so a 404 here
    // would break delete-from-a-stale-list / double-click).
    const ok = world.deleteDocument(req.params.name, req.params.docId);
    res.json({ deleted: ok });
  });

  // ── Phase 3: book ↔ world binding (relevance-pull + curate/snapshot) ──

  // Relevance-pull: AI proposes ranked, reasoned docs from the book's bound world.
  // Fail-soft inside the service (full catalog, reason 'manual') — never throws.
  app.post('/api/books/:slug/world/propose', async (req: Request, res: Response) => {
    const world = services.world;
    const books = services.books;
    if (!world || !books) return res.status(503).json({ error: 'World/Books service not initialized' });
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug) || !books.exists?.(slug)) return res.status(404).json({ error: 'Book not found' });
    try {
      const opened = await books.open(slug);
      const worldName = opened?.manifest?.pulledFrom?.world?.name;
      if (!worldName) return res.status(404).json({ error: 'Book has no bound world' });

      const signals = {
        title: opened.manifest.title,
        description: '',
        genre: opened.manifest.pulledFrom?.genre?.name ?? null,
        knownEntities: books.worldbuildingOf?.(slug) ?? '',
      };
      const ai = {
        complete: (r: any) => services.aiRouter.complete(r),
        select: (t: string) => services.aiRouter.selectProvider(t),
      };
      const proposals = await world.proposeWorldDocs(slug, signals, worldName, ai);
      res.json({ proposals });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || 'propose failed' });
    }
  });

  // Save the ordered appendix selection onto the book manifest.
  app.put('/api/books/:slug/world/appendix', async (req: Request, res: Response) => {
    const books = services.books;
    if (!books) return res.status(503).json({ error: 'Books service not initialized' });
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug) || !books.exists?.(slug)) return res.status(404).json({ error: 'Book not found' });
    const raw = (req.body && (req.body as any).appendix);
    if (!Array.isArray(raw)) return res.status(400).json({ error: 'appendix must be an array' });
    const entries: Array<{ docId: string; title?: string; order: number }> = [];
    for (const e of raw) {
      if (!e || typeof e.docId !== 'string' || !e.docId) {
        return res.status(400).json({ error: 'each appendix entry needs a docId' });
      }
      if (typeof e.order !== 'number' || !Number.isFinite(e.order)) {
        return res.status(400).json({ error: 'each appendix entry needs a numeric order' });
      }
      if (e.title !== undefined && typeof e.title !== 'string') {
        return res.status(400).json({ error: 'appendix title must be a string' });
      }
      entries.push({ docId: e.docId, order: e.order, ...(e.title ? { title: e.title } : {}) });
    }
    try {
      const manifest = await books.setAppendix(slug, entries);
      if (!manifest) return res.status(404).json({ error: 'book not found' });
      res.json({ appendix: manifest.appendix ?? [] });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || 'set appendix failed' });
    }
  });

  // Curate + snapshot: save the chosen world doc ids as the book's bible and
  // snapshot them into templates/world/ (+ .baseline for 3-way re-pull).
  app.put('/api/books/:slug/world/docs', async (req: Request, res: Response) => {
    const world = services.world;
    const books = services.books;
    if (!world || !books) return res.status(503).json({ error: 'World/Books service not initialized' });
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug) || !books.exists?.(slug)) return res.status(404).json({ error: 'Book not found' });
    const worldName = req.body?.world;
    const docIds = req.body?.docIds;
    if (typeof worldName !== 'string' || !worldName) return res.status(400).json({ error: 'world (string) is required' });
    if (!Array.isArray(docIds) || !docIds.every((d) => typeof d === 'string')) {
      return res.status(400).json({ error: 'docIds (string[]) is required' });
    }
    if (!world.getConfig(worldName)) return res.status(404).json({ error: 'World not found' });

    const source = services.library?.get?.('world', worldName)?.source ?? 'workspace';
    const getConfigRaw = (n: string) => { const c = world.getConfig(n); return c ? JSON.stringify(c, null, 2) : null; };
    const getDocSerialized = (n: string, id: string) => { const d = world.getDocument(n, id); return d ? serializeWorldDoc(d.meta, d.body) : null; };

    try {
      const { written } = await books.snapshotWorldDocs(slug, { name: worldName, source }, docIds, getConfigRaw, getDocSerialized);
      res.json({ worldDocs: written });
    } catch (err) {
      res.status(400).json({ error: (err as Error)?.message || 'snapshot failed' });
    }
  });

  // Bind a book to a world: set pulledFrom.world + auto-propose the initial bible.
  app.put('/api/books/:slug/world', async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) return res.status(404).json({ error: 'Book not found' });
    const worldName = req.body?.world;
    if (typeof worldName !== 'string' || !worldName) return res.status(400).json({ error: 'world (string) is required' });
    try {
      const result = await bindBookWorld(services, slug, worldName);
      res.json(result);
    } catch (err) {
      const msg = (err as Error)?.message || 'bind failed';
      res.status(/not found/i.test(msg) ? 404 : 400).json({ error: msg });
    }
  });

  // Unbind a book's world (clear binding + bible).
  app.delete('/api/books/:slug/world', async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug) || !services.books?.exists?.(slug)) return res.status(404).json({ error: 'Book not found' });
    try {
      const unbound = await unbindBookWorld(services, slug);
      res.json({ unbound });
    } catch (err) {
      res.status(400).json({ error: (err as Error)?.message || 'unbind failed' });
    }
  });
}
