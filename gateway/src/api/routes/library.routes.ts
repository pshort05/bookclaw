import { Application, Request, Response } from 'express';
import { LIBRARY_KINDS, type LibraryKind } from '../../services/library-types.js';

/**
 * Library read API (book-container Phase 1). Read-only: lists and serves the
 * resolved built-in + workspace-overlay templates. The write/edit path (editor
 * re-point, two edit scopes, re-pull) is Phase 4; book snapshots are Phase 2.
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
}
