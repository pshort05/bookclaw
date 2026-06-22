import { Application, Request, Response } from 'express';

/**
 * World Repository documents API (World Repository Phase 1). World CONFIG
 * create/edit rides the existing library API; these routes own the documents
 * (catalog/read/create+auto-classify/update/delete). Behind the same bearer
 * auth + IP allowlist as the rest of /api/*.
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
    const ok = world.deleteDocument(req.params.name, req.params.docId);
    res.json({ deleted: ok });
  });
}
