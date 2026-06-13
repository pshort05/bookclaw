import { Application, Request, Response } from 'express';
import { uploadZip, requireApprovedConfirmation } from './_shared.js';
import { type ImportFinding } from '../../services/book-transfer.js';
import { SLUG_RE } from '../../services/book-types.js';
import { buildBookCards } from '../../services/book-card.js';

/**
 * Books API (book-container Phase 2 + Phase 4). Read + create + template editing.
 * Behind the same bearer-auth + IP allowlist as the rest of /api/*.
 */
export function mountBooks(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  // Allowlist for repull :kind param — defense-in-depth guard on the POST route.
  const REPULL_KINDS = ['author', 'voice', 'genre', 'pipeline', 'section', 'skill'];

  // Singular kind allowlist for the templates routes.
  const TEMPLATE_KINDS = ['author', 'voice', 'genre', 'pipeline', 'section', 'skill'];
  // Kinds that have a single snapshot per book — reject a :name param for these.
  const NO_NAME_KINDS = new Set(['author', 'voice', 'genre', 'pipeline']);

  app.get('/api/books', (_req: Request, res: Response) => {
    // Phase 9: enrich each summary with its suggested next action + live state.
    // live is derived from active projects bound to the book (Phase 8 bookSlug).
    const engine = gateway.getProjectEngine?.();
    const active = engine ? engine.listProjects('active') : [];
    const cards = buildBookCards(
      services.books.list(),
      (slug: string) => services.books.nextStep(slug),
      active,
      (slug: string) => services.books.phasesForBook(slug),
    );
    res.json({ books: cards });
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
      if (authorDir && gateway.soul) await gateway.soul.useBook(authorDir, services.books.activeVoiceDir());
      res.json({ success: true, active: slug });
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      res.status(/unknown/i.test(msg) ? 404 : 500).json({ error: msg });
    }
  });

  app.delete('/api/books/:slug', async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    // #3: gate on directory existence, NOT a parseable book.json — a book with a
    // corrupt manifest must still be deletable (DELETE is the recovery path).
    if (!services.books.exists(slug)) return res.status(404).json({ error: 'Book not found' });
    const wasActive = services.books.getActiveBook() === slug;
    try {
      const { active } = await services.books.delete(slug);
      // #10: only touch the soul when the ACTIVE book actually changed.
      if (wasActive && gateway.soul) {
        if (active) {
          await gateway.soul.useBook(services.books.activeAuthorDir(), services.books.activeVoiceDir());
        } else {
          // #4: re-seed failed → no active book → reset soul off the now-deleted dir.
          await gateway.soul.resetToInitial();
        }
      }
      res.json({ deleted: slug, active });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });

  // Suggested next step for the active book. Must come before /api/books/:slug.
  app.get('/api/books/active/next', (_req: Request, res: Response) => {
    const slug = services.books.getActiveBook();
    if (!slug) return res.status(404).json({ error: 'No active book' });
    const next = services.books.nextStep(slug);
    if (!next) return res.status(404).json({ error: 'Book not found' });
    res.json({ next });
  });

  app.get('/api/books/:slug', async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    const result = await services.books.open(slug);
    if (!result) return res.status(404).json({ error: 'Book not found' });
    const descriptions = {
      author: services.books.assetDescription(slug, 'author'),
      voice:  services.books.assetDescription(slug, 'voice'),
      genre:  services.books.assetDescription(slug, 'genre'),
    };
    res.json({ book: result.manifest, status: result.status, descriptions, phases: services.books.phasesForBook(slug) });
  });

  // Suggested next step for a specific book.
  app.get('/api/books/:slug/next', (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    const next = services.books.nextStep(slug);
    if (!next) return res.status(404).json({ error: 'Book not found' });
    res.json({ next });
  });

  // Output files in a book's data/ dir — lets Write/Chat list a book's prior
  // outputs without a bound project (Phase 8 will bind projects to books).
  app.get('/api/books/:slug/files', (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    const files = services.books.listFiles(slug);
    if (files === null) return res.status(404).json({ error: 'Book not found' });
    res.json({ files });
  });

  app.post('/api/books', async (req: Request, res: Response) => {
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return res.status(400).json({ error: 'title (string) is required' });
    if (typeof body.author !== 'string' || !body.author) return res.status(400).json({ error: 'author (string) is required' });
    if (typeof body.voice !== 'string' || !body.voice) return res.status(400).json({ error: 'voice (string) is required' });
    if (typeof body.pipeline !== 'string' || !body.pipeline) return res.status(400).json({ error: 'pipeline (string) is required' });
    const genre = (typeof body.genre === 'string' && body.genre) ? body.genre : null;
    const sections = Array.isArray(body.sections) ? body.sections.filter((s: unknown) => typeof s === 'string') : [];
    try {
      const manifest = await services.books.create({ title, author: body.author, voice: body.voice, genre, pipeline: body.pipeline, sections });
      res.json({ success: true, book: manifest });
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      res.status(/unknown|required/i.test(msg) ? 400 : 500).json({ error: msg });
    }
  });

  // Read the active book's snapshot for a kind (singular). Multi-file kinds → {files};
  // pipeline → {content}; section (no name) → {entries}; section (name) → {content}.
  app.get('/api/books/active/templates/:kind/:name?', (req: Request, res: Response) => {
    const slug = services.books.getActiveBook();
    if (!slug) return res.status(409).json({ error: 'No active book' });
    const kind = String(req.params.kind);
    const name = req.params.name ? String(req.params.name) : undefined;
    if (!TEMPLATE_KINDS.includes(kind)) return res.status(400).json({ error: `invalid kind: ${kind}` });
    if (name !== undefined && NO_NAME_KINDS.has(kind)) return res.status(400).json({ error: `${kind} takes no name` });
    if (kind === 'skill' && name === undefined) return res.status(400).json({ error: 'skill requires a name' });
    if (name !== undefined && !SLUG_RE.test(name)) return res.status(400).json({ error: 'invalid name' });
    try {
      const out = services.books.readTemplate(slug, kind as any, name);
      if (!out) return res.status(404).json({ error: `${kind} snapshot not found` });
      res.json({ kind, ...(name ? { name } : {}), ...out });
    } catch (err) { res.status(500).json({ error: (err as Error)?.message || String(err) }); }
  });

  // Write the active book's snapshot for a kind (singular). author/voice → soul.reload().
  app.put('/api/books/active/templates/:kind/:name?', async (req: Request, res: Response) => {
    const slug = services.books.getActiveBook();
    if (!slug) return res.status(409).json({ error: 'No active book' });
    const kind = String(req.params.kind);
    const name = req.params.name ? String(req.params.name) : undefined;
    if (!TEMPLATE_KINDS.includes(kind)) return res.status(400).json({ error: `invalid kind: ${kind}` });
    if (name !== undefined && NO_NAME_KINDS.has(kind)) return res.status(400).json({ error: `${kind} takes no name` });
    if (name !== undefined && !SLUG_RE.test(name)) return res.status(400).json({ error: 'invalid name' });
    try {
      const r = await services.books.writeTemplate(slug, kind as any, name, { files: req.body?.files, content: req.body?.content, description: req.body?.description });
      if (kind === 'author' || kind === 'voice') await gateway.soul?.reload?.();
      res.json({ success: true, kind, ...(name ? { name } : {}), wired: r.wired });
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      res.status(/^invalid:|required|bad file|must have|must be/i.test(msg) ? 400 : 500).json({ error: msg });
    }
  });

  // Per-asset re-pull status for the active book.
  app.get('/api/books/active/repull', async (_req: Request, res: Response) => {
    const slug = services.books.getActiveBook();
    if (!slug) return res.status(409).json({ error: 'No active book' });
    try {
      res.json({ slug, assets: await services.books.repullStatus(slug) });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });

  // Re-pull one asset of the active book. body: { resolution?: 'take-library' | 'keep-book' }.
  app.post('/api/books/active/repull/:kind/:name', async (req: Request, res: Response) => {
    const slug = services.books.getActiveBook();
    if (!slug) return res.status(409).json({ error: 'No active book' });
    const kind = String(req.params.kind), name = String(req.params.name);
    if (!REPULL_KINDS.includes(kind)) return res.status(400).json({ error: 'invalid kind' });
    if (!SLUG_RE.test(name)) return res.status(400).json({ error: 'invalid name' });
    const resolution = req.body?.resolution === 'keep-book' ? 'keep-book'
      : req.body?.resolution === 'take-library' ? 'take-library' : undefined;
    try {
      const result = await services.books.repull(slug, kind as any, name, { resolution });
      if (kind === 'author' || kind === 'voice') await gateway.soul?.reload?.();
      res.json({ success: true, ...result });
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      res.status(/no longer has|invalid/i.test(msg) ? 400 : 500).json({ error: msg });
    }
  });

  // ── Phase 5: share / import ────────────────────────────────────────────────
  // Export a book as a .zip download. ?token= fallback works (native <a download>).
  app.get('/api/books/:slug/export', (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    try {
      const buf = services.bookTransfer.export(slug);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${slug}.zip"`);
      res.send(buf);
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      res.status(/not found|invalid/i.test(msg) ? 404 : 500).json({ error: msg });
    }
  });

  // Import a book .zip. Clean → lands; flagged → ConfirmationGate; structural → 400.
  app.post('/api/books/import', uploadZip.single('file'), async (req: Request, res: Response) => {
    const file = (req as unknown as { file?: { buffer: Buffer } }).file;
    if (!file?.buffer) return res.status(400).json({ error: 'a .zip file upload (field "file") is required' });
    try {
      const staged = services.bookTransfer.validateAndStage(file.buffer);
      if (staged.structuralError) return res.status(400).json({ error: staged.structuralError });
      try {
        if (staged.findings.length === 0 && staged.versionStatus === 'ok') {
          const mf = await services.bookTransfer.finalizeImport(staged.stagingId);
          return res.json({ imported: mf.slug });
        }
        const reasons: string[] = [];
        if (staged.findings.length) reasons.push(`${staged.findings.length} injection finding(s)`);
        if (staged.versionStatus !== 'ok') reasons.push(`version ${staged.versionStatus}`);
        const conf = await services.confirmationGate.createRequest({
          service: 'book-transfer',
          action: 'import',
          platform: 'api',
          description: `Import a book — ${reasons.join(', ')}`,
          payload: { stagingId: staged.stagingId, versionStatus: staged.versionStatus, findingCount: staged.findings.length },
          riskLevel: 'high',
          isReversible: true,
          disclosures: staged.findings.map((f: ImportFinding) => `${f.path}: ${f.type} (${f.confidence})`),
        });
        return res.json({ gated: true, confirmationId: conf.id, findings: staged.findings, versionStatus: staged.versionStatus });
      } catch (err) {
        services.bookTransfer.purgeStaging(staged.stagingId);
        return res.status(500).json({ error: (err as Error)?.message || String(err) });
      }
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });

  // Finalize a gated import AFTER the confirmation was approved in the dashboard.
  app.post('/api/books/import/finalize', async (req: Request, res: Response) => {
    const id = typeof req.body?.confirmationId === 'string' ? req.body.confirmationId : '';
    const gate = requireApprovedConfirmation(services.confirmationGate, { id, expectedService: 'book-transfer' });
    if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
    try {
      const mf = await services.bookTransfer.finalizeImport(String(gate.request.payload?.stagingId));
      // Transition the confirmation off 'approved' so a replay is rejected at the gate.
      await services.confirmationGate.recordOutcome(id, { success: true, message: `Imported ${mf.slug}`, executedAt: new Date().toISOString() });
      res.json({ imported: mf.slug });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });
}
