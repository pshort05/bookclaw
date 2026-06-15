import { Application, Request, Response } from 'express';
import { uploadZip, requireApprovedConfirmation } from './_shared.js';
import { LIBRARY_KINDS, type LibraryKind } from '../../services/library-types.js';
import { ENTRY_NAME_RE } from '../../services/library.js';
import type { ImportFinding } from '../../services/transfer-security.js';

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

  // ── Phase 12: share / import ───────────────────────────────────────────────
  // Export one resolved entry (built-ins too) as a .zip download. ?token=
  // fallback works (native <a download>).
  app.get('/api/library/:kind/:name/export', (req: Request, res: Response) => {
    if (!services.libraryTransfer) return res.status(503).json({ error: 'Library transfer unavailable (see startup log)' });
    const kind = String(req.params.kind);
    if (!isKind(kind)) {
      return res.status(400).json({ error: `Unknown kind. One of: ${LIBRARY_KINDS.join(', ')}` });
    }
    const name = String(req.params.name);
    if (!ENTRY_NAME_RE.test(name)) return res.status(400).json({ error: `Invalid name: ${name}` });
    try {
      const buf = services.libraryTransfer.export(kind, name);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="library-${kind}-${name}.zip"`);
      res.send(buf);
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      // Name was pre-validated above, so a "not found" here is a genuine miss → 404.
      res.status(/not found/i.test(msg) ? 404 : 500).json({ error: msg });
    }
  });

  // Import a library-entry .zip. Clean → lands in the workspace overlay;
  // flagged → ConfirmationGate; structural → 400. Registered BEFORE the
  // write-path POST /api/library/:kind so "import" isn't captured as a kind.
  app.post('/api/library/import', uploadZip.single('file'), async (req: Request, res: Response) => {
    if (!services.libraryTransfer) return res.status(503).json({ error: 'Library transfer unavailable (see startup log)' });
    const file = (req as unknown as { file?: { buffer: Buffer } }).file;
    if (!file?.buffer) return res.status(400).json({ error: 'a .zip file upload (field "file") is required' });
    try {
      const staged = services.libraryTransfer.validateAndStage(file.buffer);
      if (staged.structuralError) return res.status(400).json({ error: staged.structuralError });
      const { kind, name } = staged.manifest;
      try {
        if (staged.findings.length === 0) {
          const entry = await services.libraryTransfer.finalizeImport(staged.stagingId);
          return res.json({ ok: true, entry });
        }
        // The gate runs payloadClaimsPreAuth over description+payload, so keep
        // attacker-controlled strings (entry name, finding pattern text) OUT of
        // both — a hostile name/pattern would otherwise make createRequest throw.
        // The full findings still go back in the (unscanned) response body.
        const conf = await services.confirmationGate.createRequest({
          service: 'library-transfer',
          action: 'import_library_entry',
          platform: 'library',
          riskLevel: 'high',
          isReversible: true,
          description: `${kind} import with ${staged.findings.length} finding(s)`,
          payload: {
            stagingId: staged.stagingId,
            kind,
            findings: staged.findings.map((f: ImportFinding) => ({ path: f.path, type: f.type, confidence: f.confidence })),
          },
        });
        return res.status(202).json({ pendingConfirmation: conf.id, findings: staged.findings });
      } catch (err) {
        services.libraryTransfer.purgeStaging(staged.stagingId);
        return res.status(500).json({ error: (err as Error)?.message || String(err) });
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });

  // Finalize a gated import AFTER the confirmation was approved in the dashboard.
  app.post('/api/library/import/finalize', async (req: Request, res: Response) => {
    if (!services.libraryTransfer) return res.status(503).json({ error: 'Library transfer unavailable (see startup log)' });
    const id = typeof req.body?.confirmationId === 'string' ? req.body.confirmationId : '';
    const gate = requireApprovedConfirmation(services.confirmationGate, { id, expectedService: 'library-transfer' });
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    try {
      const entry = await services.libraryTransfer.finalizeImport(String(gate.request.payload?.stagingId));
      // Transition the confirmation off 'approved' so a replay is rejected at the gate.
      await services.confirmationGate.recordOutcome(id, { success: true, message: `Imported ${entry?.kind ?? 'entry'}`, executedAt: new Date().toISOString() });
      res.json({ ok: true, entry });
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      // One-shot finalize: a consumed/expired/unknown stagingId → 404, not 500.
      res.status(/missing|consumed|expired|invalid stagingid/i.test(msg) ? 404 : 500).json({ error: msg });
    }
  });

  // ── Write path (Phase 4): workspace-overlay CRUD. Built-ins are read-only;
  // skills are handled by /api/skills (SkillLoader overlay). ─────────────────
  const WRITABLE = ['author', 'voice', 'genre', 'pipeline', 'editor', 'section'] as const;
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
