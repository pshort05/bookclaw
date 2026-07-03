import { Application, Request, Response } from 'express';
import multer from 'multer';
import { existsSync } from 'fs';
import { join } from 'path';
import { uploadZip, requireApprovedConfirmation, safePath, serveFile } from './_shared.js';
import { type ImportFinding } from '../../services/book-transfer.js';
import { SLUG_RE } from '../../services/book-types.js';
import { buildBookCards } from '../../services/book-card.js';
import { writeWithVersion, listVersions, restoreVersion } from '../../services/file-versions.js';
import { mapRunnerPath, isUploadableName, resolveBookUpload } from '../../services/runner-files.js';
import { bindBookWorld } from './world-bind.js';
import { buildBookFormat } from '../../services/format-input.js';
import { AI_PROVIDER_IDS } from '../../ai/router.js';
import { assembleManuscript, validateAssembly } from '../../services/manuscript-assembly.js';
import { generateDocxBuffer } from '../../services/docx-export.js';

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
      // Cascade: remove the book's projects too. BookService.delete() only drops
      // the book dir + active-book pointer; without this the projects (incl. any
      // still 'active') are orphaned in projects-state.json — the "ghost" that
      // survives the delete and reloads on the next boot.
      const removedProjects = gateway.getProjectEngine?.()?.deleteProjectsByBook(slug) ?? 0;
      // #10: only touch the soul when the ACTIVE book actually changed.
      if (wasActive && gateway.soul) {
        if (active) {
          await gateway.soul.useBook(services.books.activeAuthorDir(), services.books.activeVoiceDir());
        } else {
          // #4: re-seed failed → no active book → reset soul off the now-deleted dir.
          await gateway.soul.resetToInitial();
        }
      }
      res.json({ deleted: slug, active, removedProjects });
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

  // Cross-book fleet state (Flagship Plan 6, Task 5). Must come before
  // /api/books/:slug (a literal "fleet" would otherwise be swallowed by :slug).
  // L1 fix: a book's state is the HIGHEST-priority state across ALL its
  // projects (running > queued > paused_budget > paused_review > idle), not
  // just the first project in array order — a book with an earlier paused
  // project and a later running one must report running. Wrapped fail-soft
  // (matching sibling routes) so an unavailable book/project service 500s
  // with a JSON error instead of crashing the request.
  const FLEET_STATE_PRIORITY = ['running', 'queued', 'paused_budget', 'paused_review', 'idle'] as const;
  type FleetState = (typeof FLEET_STATE_PRIORITY)[number];

  app.get('/api/books/fleet', (_req: Request, res: Response) => {
    try {
      const engine = gateway.getProjectEngine?.();
      const projects = engine ? engine.listProjects() : [];
      const running = new Set(services.driveScheduler?.running?.() ?? []);
      const queued = new Set(services.driveScheduler?.queued?.() ?? []);

      const stateOfProject = (p: any): FleetState => {
        if (running.has(p.id)) return 'running';
        if (queued.has(p.id)) return 'queued';
        if (p.status === 'paused' && p.budgetPause) return 'paused_budget';
        if (p.status === 'paused' && p.review) return 'paused_review';
        return 'idle';
      };
      const stateFor = (slug: string): FleetState => {
        const bookProjects = projects.filter((p: any) => p.bookSlug === slug);
        let best: FleetState = 'idle';
        let bestRank = FLEET_STATE_PRIORITY.indexOf('idle');
        for (const p of bookProjects) {
          const rank = FLEET_STATE_PRIORITY.indexOf(stateOfProject(p));
          if (rank < bestRank) { bestRank = rank; best = FLEET_STATE_PRIORITY[rank]; }
        }
        return best;
      };

      const fleet = services.books.list().map((b: any) => ({
        slug: b.slug,
        title: b.title,
        state: stateFor(b.slug),
      }));
      res.json({ fleet });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
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

  // The book's current/frontier project (the chained pipeline's active phase) so
  // the Write rail binds to the live project, not just the pipeline template.
  // { project: null } when the book has no projects yet.
  app.get('/api/books/:slug/current-project', (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    if (!services.books.exists(slug)) return res.status(404).json({ error: 'Book not found' });
    const project = gateway.getProjectEngine?.()?.frontierProjectForBook(slug) ?? null;
    res.json({ project });
  });

  // Book Format & Structure: set/update the declared format on an existing book
  // (same hard-block band validation as creation).
  app.put('/api/books/:slug/format', async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    const fmt = buildBookFormat(req.body || {}, services.storyStructures);
    if (fmt.error) return res.status(400).json({ error: fmt.error });
    if (!fmt.format) return res.status(400).json({ error: 'format fields required' });
    try {
      const manifest = await services.books.setFormat(slug, fmt.format);
      res.json({ ok: true, format: manifest.format });
    } catch (e) {
      res.status(404).json({ error: (e as Error)?.message || 'book not found' });
    }
  });

  // Composed world-building snapshot for a book (Series Phase B) — the same
  // string injected into prompts. { worldbuilding: string|null }.
  app.get('/api/books/:slug/worldbuilding', (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    res.json({ worldbuilding: services.books.worldbuildingOf(slug) });
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

  // Serve one of a book's data/ output files — file explorer preview + download
  // (?download=1 forces an attachment). Read-only; SLUG_RE + safePath guarded.
  app.get('/api/books/:slug/files/:filename', (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    const dataDir = services.books.dataDirOf(slug);
    if (!dataDir) return res.status(404).json({ error: 'Book not found' });
    const filename = String(req.params.filename);
    const filePath = safePath(dataDir, filename);
    if (!filePath) return res.status(403).json({ error: 'Path traversal blocked' });
    if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    // serveFile streams the file; a read error after the existsSync check (delete/
    // permission race) rejects the promise — catch it so it isn't unhandled, and
    // tear down the (possibly half-written) response.
    serveFile(res, filePath, filename, !!req.query.download).catch(() => res.destroy());
  });

  // Assemble + download the latest FULL novel from the book's per-chapter files
  // (deterministic — latest polish>write, ordered, headers stripped). The
  // production "compile" step only wrote a report and the revision rewrites
  // truncated, so this is the reliable full-manuscript artifact. ?format=md|docx.
  app.get('/api/books/:slug/download/latest-manuscript', async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    const format = (String(req.query.format || 'md').toLowerCase() === 'docx') ? 'docx' : 'md';
    const dataDir = services.books.dataDirOf(slug);
    if (!dataDir || !existsSync(dataDir)) return res.status(404).json({ error: 'Book not found' });
    const opened = await services.books.open(slug).catch(() => null);
    const manifest: any = opened?.manifest ?? {};
    const title = String(manifest.title || slug);
    const author = String(manifest.pulledFrom?.author?.name || manifest.author?.name || 'BookClaw');

    const { readdirSync, readFileSync, statSync } = await import('fs');
    const files = readdirSync(dataDir)
      .filter((n) => n.endsWith('.md'))
      .map((name) => {
        const p = safePath(dataDir, name);
        if (!p) return null;
        try { return { name, content: readFileSync(p, 'utf-8'), mtime: statSync(p).mtimeMs }; } catch { return null; }
      })
      .filter((f): f is { name: string; content: string; mtime: number } => !!f);

    const assembled = assembleManuscript(files, { title, author });
    const check = validateAssembly(assembled, { expectedChapters: manifest.format?.chapterCount });
    if (assembled.chapterCount === 0) {
      return res.status(404).json({ error: 'No assembled novel yet — run a production pipeline to write the chapters.' });
    }
    const baseName = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'manuscript';
    res.setHeader('X-Manuscript-Chapters', String(assembled.chapterCount));
    res.setHeader('X-Manuscript-Words', String(assembled.wordCount));
    if (!check.ok) res.setHeader('X-Manuscript-Warnings', encodeURIComponent(check.problems.join('; ')));

    if (format === 'docx') {
      try {
        const buf = await generateDocxBuffer({ title, author, content: assembled.markdown });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${baseName}.docx"`);
        return res.send(buf);
      } catch (err) {
        return res.status(500).json({ error: `DOCX export failed: ${(err as Error)?.message || err}` });
      }
    }
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.md"`);
    return res.send(assembled.markdown);
  });

  // Write-back a book data/ file, snapshotting the prior content (Prompt Runner Replace).
  app.put('/api/books/:slug/files/:filename', async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    const dataDir = services.books.dataDirOf(slug);
    if (!dataDir) return res.status(404).json({ error: 'Book not found' });
    const filename = String(req.params.filename);
    if (!safePath(dataDir, filename)) return res.status(403).json({ error: 'Path traversal blocked' });
    const { content } = req.body ?? {};
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    try {
      await writeWithVersion(dataDir, filename, content);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });

  // List prior versions of a book data/ file (newest first).
  app.get('/api/books/:slug/files/:filename/versions', async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    const dataDir = services.books.dataDirOf(slug);
    if (!dataDir) return res.status(404).json({ error: 'Book not found' });
    const filename = String(req.params.filename);
    if (!safePath(dataDir, filename)) return res.status(403).json({ error: 'Path traversal blocked' });
    try {
      res.json({ versions: await listVersions(dataDir, filename) });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });

  // Restore a prior version of a book data/ file (the current content is snapshotted first).
  app.post('/api/books/:slug/files/:filename/restore', async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    const dataDir = services.books.dataDirOf(slug);
    if (!dataDir) return res.status(404).json({ error: 'Book not found' });
    const filename = String(req.params.filename);
    if (!safePath(dataDir, filename)) return res.status(403).json({ error: 'Path traversal blocked' });
    const { id } = req.body ?? {};
    if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'id required' });
    try { await restoreVersion(dataDir, filename, id); res.json({ ok: true }); }
    catch (err: any) {
      const msg = String(err?.message || err);
      // Only the deliberate "not found" / "invalid id" throws are 404; a real
      // write/IO failure must surface as 500, not masquerade as a bad version id.
      const notFound = msg === 'version not found' || msg === 'invalid version id';
      res.status(notFound ? 404 : 500).json({ error: msg });
    }
  });

  // ── Prompt Runner: book-root file API (data/ outputs + templates/ snapshots) ──
  // Lets the runner target any file under data/ or templates/ by a book-root path
  // (e.g. "templates/genre/world.md"). mapRunnerPath confines access to those two
  // subtrees (book.json/.baseline/dotfiles unreachable) and matches the per-subtree
  // version-sidecar location so data files keep their existing history.

  // List a book's runnable files (data/ + templates/).
  app.get('/api/books/:slug/runner-files', (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    const files = services.books.listRunnerFiles(slug);
    if (files === null) return res.status(404).json({ error: 'Book not found' });
    res.json({ files });
  });

  // Upload a text file into a book directory under data/ or templates/ (file explorer).
  // Confined by resolveBookUpload (mapRunnerPath) + safePath; refuses to overwrite an
  // existing file (409) so an upload can't silently replace book content; text-only
  // allowlist (.md/.txt/.json/.csv), 10MB. The multer middleware is wrapped so a
  // size/limit error returns a JSON 4xx instead of the generic error page.
  const bookUploadMw = multer({
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, isUploadableName(file.originalname || '')),
    storage: multer.memoryStorage(),
  }).single('file');
  app.post('/api/books/:slug/upload',
    (req: Request, res: Response, next) => bookUploadMw(req, res, (err: unknown) => {
      if (err) return res.status((err as { code?: string })?.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: (err as Error)?.message || 'upload error' });
      next();
    }),
    async (req: Request, res: Response) => {
      const slug = String(req.params.slug);
      if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
      const bookDir = services.books.bookDir(slug);
      if (!bookDir || !existsSync(join(bookDir, 'book.json'))) return res.status(404).json({ error: 'Book not found' });
      const file = (req as unknown as { file?: { originalname: string; buffer: Buffer } }).file;
      if (!file?.buffer) return res.status(400).json({ error: 'a text file upload (field "file", .md/.txt/.json/.csv) is required' });
      const dir = String(req.body?.dir ?? '');
      const name = gateway.sandbox.sanitizeFilename(file.originalname || 'upload').replace(/^\.+/, '').slice(0, 200) || 'upload';
      if (!isUploadableName(name)) return res.status(400).json({ error: 'unsupported file type (use .md/.txt/.json/.csv)' });
      const mapped = resolveBookUpload(bookDir, dir, name);
      if (!mapped) return res.status(400).json({ error: 'dir must be under data/ or templates/' });
      const target = safePath(mapped.baseDir, mapped.filename);
      if (!target) return res.status(403).json({ error: 'Path traversal blocked' });
      if (existsSync(target)) return res.status(409).json({ error: `A file named "${name}" already exists in ${dir.replace(/\/+$/, '')}/` });
      try {
        await writeWithVersion(mapped.baseDir, mapped.filename, file.buffer.toString('utf-8'));
        res.json({ ok: true, path: `${dir.replace(/\/+$/, '')}/${name}` });
      } catch (err) {
        res.status(500).json({ error: (err as Error)?.message || String(err) });
      }
    });

  /** Resolve ?path / body.path against a book's data|templates subtrees, or send an error. */
  const resolveRunnerFile = (slug: string, rel: string, res: Response): { baseDir: string; filename: string } | null => {
    if (!SLUG_RE.test(slug)) { res.status(400).json({ error: 'invalid slug' }); return null; }
    const bookDir = services.books.bookDir(slug);
    if (!bookDir || !existsSync(join(bookDir, 'book.json'))) { res.status(404).json({ error: 'Book not found' }); return null; }
    const mapped = mapRunnerPath(bookDir, rel);
    if (!mapped) { res.status(400).json({ error: 'path must be under data/ or templates/' }); return null; }
    return mapped;
  };

  // Read any data/ or templates/ file by book-root path.
  app.get('/api/books/:slug/file', (req: Request, res: Response) => {
    const rel = String(req.query.path ?? '');
    const mapped = resolveRunnerFile(String(req.params.slug), rel, res);
    if (!mapped) return;
    const filePath = safePath(mapped.baseDir, mapped.filename);
    if (!filePath) return res.status(403).json({ error: 'Path traversal blocked' });
    if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
    serveFile(res, filePath, mapped.filename.split('/').pop() || 'file', !!req.query.download).catch(() => res.destroy());
  });

  // Write-back any data/ or templates/ file by book-root path (snapshots the prior content).
  app.put('/api/books/:slug/file', async (req: Request, res: Response) => {
    const rel = String(req.body?.path ?? '');
    const mapped = resolveRunnerFile(String(req.params.slug), rel, res);
    if (!mapped) return;
    if (!safePath(mapped.baseDir, mapped.filename)) return res.status(403).json({ error: 'Path traversal blocked' });
    const { content } = req.body ?? {};
    if (typeof content !== 'string') return res.status(400).json({ error: 'content required' });
    try {
      await writeWithVersion(mapped.baseDir, mapped.filename, content);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });

  // List prior versions of any data/ or templates/ file.
  app.get('/api/books/:slug/file/versions', async (req: Request, res: Response) => {
    const rel = String(req.query.path ?? '');
    const mapped = resolveRunnerFile(String(req.params.slug), rel, res);
    if (!mapped) return;
    if (!safePath(mapped.baseDir, mapped.filename)) return res.status(403).json({ error: 'Path traversal blocked' });
    try {
      res.json({ versions: await listVersions(mapped.baseDir, mapped.filename) });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });

  // Restore a prior version of any data/ or templates/ file (current content snapshotted first).
  app.post('/api/books/:slug/file/restore', async (req: Request, res: Response) => {
    const rel = String(req.body?.path ?? '');
    const mapped = resolveRunnerFile(String(req.params.slug), rel, res);
    if (!mapped) return;
    if (!safePath(mapped.baseDir, mapped.filename)) return res.status(403).json({ error: 'Path traversal blocked' });
    const { id } = req.body ?? {};
    if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'id required' });
    try { await restoreVersion(mapped.baseDir, mapped.filename, id); res.json({ ok: true }); }
    catch (err: any) {
      const msg = String(err?.message || err);
      const notFound = msg === 'version not found' || msg === 'invalid version id';
      res.status(notFound ? 404 : 500).json({ error: msg });
    }
  });

  app.post('/api/books', async (req: Request, res: Response) => {
    const body = req.body || {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return res.status(400).json({ error: 'title (string) is required' });

    let author = typeof body.author === 'string' ? body.author : '';
    let voice = typeof body.voice === 'string' ? body.voice : '';
    let pipeline = typeof body.pipeline === 'string' ? body.pipeline : '';
    let genre = (typeof body.genre === 'string' && body.genre) ? body.genre : null;
    const sections = Array.isArray(body.sections) ? body.sections.filter((s: unknown) => typeof s === 'string') : [];

    // Series Phase A: when created in a series, inherit author/voice/genre (+pipeline
    // if the series sets one) from the series' refs; record provenance + membership.
    let seriesProvenance: { id: string; title: string } | undefined;
    let seriesWorldbuilding: { characters: string; places: string; lore: string } | undefined;
    let seriesWorldName = '';
    if (typeof body.series === 'string' && body.series) {
      const series = services.seriesBible?.getSeries?.(body.series);
      if (!series) return res.status(400).json({ error: 'unknown series' });
      author = series.pulledFrom.author?.name || author;
      voice = series.pulledFrom.voice?.name || voice;
      genre = series.pulledFrom.genre?.name ?? genre;
      pipeline = series.pulledFrom.pipeline?.name || pipeline;
      seriesProvenance = { id: series.id, title: series.title };
      // Series Phase B: snapshot the series' world-building into the new book.
      seriesWorldbuilding = await services.seriesBible?.getWorldbuilding?.(series.id);
      seriesWorldName = series.pulledFrom.world?.name ?? '';
    }

    // Config-not-code pipelines (Task 13): resolve the ordered pipeline names the
    // book will run. Explicit pipelineSequence wins; else a named sequence preset;
    // else fall back to the single `pipeline` field (current behavior).
    const pipelineSequenceBody = Array.isArray(body.pipelineSequence)
      ? body.pipelineSequence.filter((p: unknown) => typeof p === 'string' && (p as string).trim().length > 0)
      : [];
    const sequenceName = (typeof body.sequence === 'string' && body.sequence) ? body.sequence : '';
    let resolvedNames: string[] = [];
    if (pipelineSequenceBody.length > 0) {
      resolvedNames = pipelineSequenceBody;
    } else if (sequenceName) {
      const seq = services.library.get('sequence', sequenceName)?.sequence?.pipelines;
      if (!Array.isArray(seq) || seq.length === 0) return res.status(400).json({ error: `unknown sequence: ${sequenceName}` });
      resolvedNames = seq;
    } else if (pipeline) {
      resolvedNames = [pipeline];
    }

    if (!author) return res.status(400).json({ error: 'author (string) is required' });
    if (!voice) return res.status(400).json({ error: 'voice (string) is required' });
    if (resolvedNames.length === 0) return res.status(400).json({ error: 'pipeline (string) is required' });

    // Validate every resolved name maps to a known pipeline; report the unknowns.
    const resolvedPipelines = resolvedNames.map((n) => ({ name: n, pipeline: services.library.get('pipeline', n)?.pipeline }));
    const unknown = resolvedPipelines.filter((p) => !p.pipeline).map((p) => p.name);
    if (unknown.length > 0) return res.status(400).json({ error: `unknown pipeline(s): ${unknown.join(', ')}` });

    // Keep the single `pipeline` field set to the FIRST name for back-compat.
    pipeline = resolvedNames[0];
    const pipelines = resolvedPipelines.map((p) => ({ name: p.name, pipeline: p.pipeline! }));

    // Book Format & Structure: validate the declared structure × form × pacing (hard
    // block out-of-band totals). Absent format fields → {} (format stays optional).
    const fmt = buildBookFormat(body, services.storyStructures);
    if (fmt.error) return res.status(400).json({ error: fmt.error });

    // Default AI provider for the book (Easy Start LLM choice). Validated against
    // the known provider ids; persisted on the manifest and inherited by projects.
    const preferredProvider = (typeof body.preferredProvider === 'string' && body.preferredProvider) ? body.preferredProvider : '';
    if (preferredProvider && !AI_PROVIDER_IDS.includes(preferredProvider as typeof AI_PROVIDER_IDS[number])) {
      return res.status(400).json({ error: `unknown provider: ${preferredProvider}` });
    }
    // Optional specific model id for the chosen provider (e.g. an OpenRouter slug).
    // Same format guard the config endpoint applies to ai.<provider>.model.
    const preferredModel = (typeof body.preferredModel === 'string' && body.preferredModel) ? body.preferredModel : '';
    if (preferredModel && !/^[A-Za-z0-9._\-/:]{1,200}$/.test(preferredModel)) {
      return res.status(400).json({ error: 'invalid model id' });
    }

    // Content axes (Flagship Plan 2): an explicit per-book ceiling overrides the
    // bound author's contentBrand at create time. Absent → fade-to-black default.
    let contentCeiling: { spice: number; violence: number } | undefined;
    if (body.contentCeiling && typeof body.contentCeiling === 'object') {
      const spice = Number((body.contentCeiling as any).spice);
      const violence = Number((body.contentCeiling as any).violence);
      if (!Number.isFinite(spice) || !Number.isFinite(violence) || spice < 0 || spice > 10 || violence < 0 || violence > 10) {
        return res.status(400).json({ error: 'contentCeiling.spice and .violence must be numbers 0-10' });
      }
      contentCeiling = { spice, violence };
    }
    const uncensoredProvider = (typeof body.uncensoredProvider === 'string' && body.uncensoredProvider) ? body.uncensoredProvider : '';
    if (uncensoredProvider && !['grok', 'venice', 'auto'].includes(uncensoredProvider)) {
      return res.status(400).json({ error: `unknown uncensoredProvider: ${uncensoredProvider}` });
    }
    // Human-review gate cadence (Flagship Plan 5): an explicit per-book value
    // overrides the bound author's reviewCadence default at create time.
    const reviewCadence = (typeof body.reviewCadence === 'string' && body.reviewCadence) ? body.reviewCadence : '';
    if (reviewCadence && !['per_act', 'per_chapter', 'outline_only', 'autonomous'].includes(reviewCadence)) {
      return res.status(400).json({ error: `unknown reviewCadence: ${reviewCadence}` });
    }
    // Per-book spend cap (C1 fix, Flagship Plan 6, Task 3): validated like the
    // other numeric axes, then wired into the RUNNING CostTracker right after
    // create() so it takes effect immediately (also re-applied on every boot —
    // see applyBookBudgets in init/phase-05-research-skills.ts).
    let costBudget: number | undefined;
    if (body.costBudget !== undefined && body.costBudget !== null && body.costBudget !== '') {
      const n = Number(body.costBudget);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ error: 'costBudget must be a finite number >= 0' });
      }
      costBudget = n;
    }

    try {
      const manifest = await services.books.create({ title, author, voice, genre, pipeline, pipelines, sections, ...(seriesProvenance ? { series: seriesProvenance } : {}), ...(seriesWorldbuilding ? { worldbuilding: seriesWorldbuilding } : {}), ...(fmt.format ? { format: fmt.format } : {}), ...(preferredProvider ? { preferredProvider } : {}), ...(preferredModel ? { preferredModel } : {}), ...(contentCeiling ? { contentCeiling } : {}), ...(uncensoredProvider ? { uncensoredProvider: uncensoredProvider as 'grok' | 'venice' | 'auto' } : {}), ...(reviewCadence ? { reviewCadence: reviewCadence as 'per_act' | 'per_chapter' | 'outline_only' | 'autonomous' } : {}), ...(costBudget !== undefined ? { costBudget } : {}) });
      if (costBudget !== undefined) services.costs?.setBookBudget(manifest.slug, costBudget);
      if (seriesProvenance) await services.seriesBible?.addBook?.(seriesProvenance.id, manifest.slug);
      const worldName = (typeof body.world === 'string' && body.world) ? body.world : seriesWorldName;
      if (worldName && services.world?.getConfig?.(worldName)) {
        try {
          await bindBookWorld(services, manifest.slug, worldName);
        } catch (e) {
          console.log(`  ⚠ World bind on create failed for ${manifest.slug}: ${(e as Error)?.message || e}`);
        }
      }
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
