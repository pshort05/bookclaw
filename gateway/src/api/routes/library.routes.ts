import { Application, Request, Response } from 'express';
import { LIBRARY_KINDS, type LibraryKind } from '../../services/library-types.js';

/**
 * Library API (book-container). Read: lists/serves the resolved built-in +
 * workspace-overlay templates. Write (Phase 4): POST/PUT/DELETE manage the
 * workspace overlay (built-ins stay read-only; deleting an overlay reverts to
 * its built-in). Skills are handled by /api/skills, not here.
 * Sits behind the same bearer-auth + IP allowlist as the rest of /api/*.
 */
export function mountLibrary(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  function isKind(v: string): v is LibraryKind {
    return (LIBRARY_KINDS as readonly string[]).includes(v);
  }

  // All entries across kinds (or ?kind=genre to filter), catalog rows only.
  app.get('/api/library', (req: Request, res: Response) => {
    const kind = req.query.kind ? String(req.query.kind) : undefined;
    if (kind && !isKind(kind)) {
      return res.status(400).json({ error: `Unknown kind. One of: ${LIBRARY_KINDS.join(', ')}` });
    }
    res.json({ kinds: LIBRARY_KINDS, entries: services.library.list(kind as LibraryKind | undefined) });
  });

  // Entries of one kind.
  app.get('/api/library/:kind', (req: Request, res: Response) => {
    const kind = String(req.params.kind);
    if (!isKind(kind)) {
      return res.status(400).json({ error: `Unknown kind. One of: ${LIBRARY_KINDS.join(', ')}` });
    }
    res.json({ kind, entries: services.library.list(kind) });
  });

  // Full content of one entry.
  app.get('/api/library/:kind/:name', (req: Request, res: Response) => {
    const kind = String(req.params.kind);
    if (!isKind(kind)) {
      return res.status(400).json({ error: `Unknown kind. One of: ${LIBRARY_KINDS.join(', ')}` });
    }
    const entry = services.library.get(kind, String(req.params.name));
    if (!entry) return res.status(404).json({ error: 'Template not found' });
    res.json({ entry });
  });

  // ── Write path (Phase 4): workspace-overlay CRUD. Built-ins are read-only;
  // skills are handled by /api/skills (SkillLoader overlay). ─────────────────
  const WRITABLE = ['author', 'voice', 'genre', 'pipeline', 'section'] as const;
  const isWritable = (v: string): v is (typeof WRITABLE)[number] =>
    (WRITABLE as readonly string[]).includes(v);

  // Create a new entry. 409 if the name already exists in any source.
  app.post('/api/library/:kind', async (req: Request, res: Response) => {
    const kind = String(req.params.kind);
    if (!isWritable(kind)) return res.status(400).json({ error: `Cannot create kind "${kind}" here (skills use /api/skills)` });
    const name = typeof req.body?.name === 'string' ? req.body.name : '';
    if (!name) return res.status(400).json({ error: 'body.name is required' });
    try {
      await services.library.createEntry(kind, name, { files: req.body?.files, content: req.body?.content, description: req.body?.description });
      await services.library.reload();
      res.json({ success: true, kind, name, source: 'workspace' });
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      res.status(/already exists/i.test(msg) ? 409 : 400).json({ error: msg });
    }
  });

  // Upsert (edit) an overlay entry.
  app.put('/api/library/:kind/:name', async (req: Request, res: Response) => {
    const kind = String(req.params.kind);
    if (!isWritable(kind)) return res.status(400).json({ error: `Cannot edit kind "${kind}" here (skills use /api/skills)` });
    try {
      await services.library.writeEntry(kind, String(req.params.name), { files: req.body?.files, content: req.body?.content, description: req.body?.description });
      await services.library.reload();
      res.json({ success: true, kind, name: String(req.params.name), source: 'workspace' });
    } catch (err) {
      res.status(400).json({ error: (err as Error)?.message || String(err) });
    }
  });

  // Delete an overlay entry (reverts to built-in if one exists). 404 if no overlay.
  app.delete('/api/library/:kind/:name', async (req: Request, res: Response) => {
    const kind = String(req.params.kind);
    if (!isWritable(kind)) return res.status(400).json({ error: `Cannot delete kind "${kind}" here (skills use /api/skills)` });
    try {
      const removed = await services.library.deleteOverlayEntry(kind, String(req.params.name));
      if (!removed) return res.status(404).json({ error: 'No workspace overlay entry to delete (built-ins are read-only)' });
      await services.library.reload();
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: (err as Error)?.message || String(err) });
    }
  });
}
