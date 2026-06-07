import { Application, Request, Response } from 'express';
import { join } from 'path';
import { readFile, writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { safePath } from './_shared.js';

/**
 * Books API (book-container Phase 2 + Phase 4). Read + create + template editing.
 * Behind the same bearer-auth + IP allowlist as the rest of /api/*.
 */
export function mountBooks(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  // Which snapshot kinds currently DRIVE generation (Phase 3): author + voice
  // (via SoulService) and pipeline. genre/sections/skills are stored records,
  // not yet injected — the UI labels them so editing them isn't a silent no-op.
  const WIRED_KINDS = new Set(['author', 'voice', 'pipeline']);
  // Relative location under templates/ for each kind.
  const TEMPLATE_SUBDIR: Record<string, string> = {
    author: 'author', voice: 'voice', genre: 'genre',
    sections: 'sections', skills: 'skills',
  };
  // Resolve the active book's templates/ dir, or null when none is active.
  const activeTemplates = (): string | null => {
    const slug = services.books.getActiveBook();
    return slug ? services.books.templatesDir(slug) : null;
  };

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
      if (authorDir && gateway.soul) await gateway.soul.useBook(authorDir, services.books.activeVoiceDir());
      res.json({ success: true, active: slug });
    } catch (err) {
      const msg = (err as Error)?.message || String(err);
      res.status(/unknown/i.test(msg) ? 404 : 500).json({ error: msg });
    }
  });

  app.delete('/api/books/:slug', async (req: Request, res: Response) => {
    const slug = String(req.params.slug);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return res.status(400).json({ error: 'invalid slug' });
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

  // Read the active book's snapshot for a kind. Multi-file kinds → {files};
  // pipeline → {content} (raw JSON); section by name → {content}.
  app.get('/api/books/active/templates/:kind/:name?', async (req: Request, res: Response) => {
    const base = activeTemplates();
    if (!base) return res.status(409).json({ error: 'No active book' });
    const kind = String(req.params.kind);
    try {
      if (kind === 'pipeline') {
        const p = safePath(base, 'pipeline.json');
        if (!p || !existsSync(p)) return res.status(404).json({ error: 'pipeline.json not found' });
        return res.json({ kind, content: await readFile(p, 'utf-8'), wired: true });
      }
      if (kind === 'sections') {
        const name = String(req.params.name || '');
        if (!name) {
          const dir = safePath(base, 'sections');
          const list = dir && existsSync(dir) ? (await readdir(dir)).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')) : [];
          return res.json({ kind, entries: list, wired: false });
        }
        const p = safePath(base, join('sections', `${name}.md`));
        if (!p || !existsSync(p)) return res.status(404).json({ error: 'section not found' });
        return res.json({ kind, name, content: await readFile(p, 'utf-8'), wired: false });
      }
      // author / voice / genre / skills: directory of files
      const sub = TEMPLATE_SUBDIR[kind];
      if (!sub) return res.status(400).json({ error: `Unknown kind: ${kind}` });
      if (kind === 'skills' && req.params.name && !/^[a-z0-9][a-z0-9-]*$/.test(String(req.params.name))) {
        return res.status(400).json({ error: 'invalid skill name' });
      }
      const dir = safePath(base, kind === 'skills' && req.params.name ? join('skills', String(req.params.name)) : sub);
      if (!dir || !existsSync(dir)) return res.status(404).json({ error: `${kind} snapshot not found` });
      const files: Record<string, string> = {};
      for (const f of await readdir(dir)) {
        if (f.endsWith('.md')) files[f] = await readFile(join(dir, f), 'utf-8');
      }
      return res.json({ kind, files, wired: WIRED_KINDS.has(kind) });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });

  // Write the active book's snapshot for a kind. Same body shapes as the library
  // write API. author/voice → soul.reload(); others read at run-time or unwired.
  app.put('/api/books/active/templates/:kind/:name?', async (req: Request, res: Response) => {
    const base = activeTemplates();
    if (!base) return res.status(409).json({ error: 'No active book' });
    const kind = String(req.params.kind);
    try {
      if (kind === 'pipeline') {
        const raw = String(req.body?.content ?? '');
        try { const p = JSON.parse(raw); if (!Array.isArray(p.steps) || typeof p.schemaVersion !== 'number') throw 0; }
        catch { return res.status(400).json({ error: 'pipeline content must be JSON with a steps array and numeric schemaVersion' }); }
        const dest = safePath(base, 'pipeline.json');
        if (!dest) return res.status(403).json({ error: 'Path traversal blocked' });
        await writeFile(dest, raw.endsWith('\n') ? raw : raw + '\n', 'utf-8');
        return res.json({ success: true, kind, wired: true });
      }
      if (kind === 'sections') {
        const name = String(req.params.name || '');
        if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return res.status(400).json({ error: 'section name required' });
        if (typeof req.body?.content !== 'string') return res.status(400).json({ error: 'content (string) required' });
        const dest = safePath(base, join('sections', `${name}.md`));
        if (!dest) return res.status(403).json({ error: 'Path traversal blocked' });
        await mkdir(join(dest, '..'), { recursive: true });
        await writeFile(dest, req.body.content, 'utf-8');
        return res.json({ success: true, kind, name, wired: false });
      }
      // author / voice / genre / skills: directory of .md files
      if (kind !== 'skills' && !TEMPLATE_SUBDIR[kind]) return res.status(400).json({ error: `Unknown kind: ${kind}` });
      const files = req.body?.files;
      if (!files || typeof files !== 'object') return res.status(400).json({ error: 'files (object) required' });
      if (kind === 'skills' && !/^[a-z0-9][a-z0-9-]*$/.test(String(req.params.name || ''))) {
        return res.status(400).json({ error: 'skill name required' });
      }
      const rel = kind === 'skills' ? join('skills', String(req.params.name)) : TEMPLATE_SUBDIR[kind];
      for (const fname of Object.keys(files)) {
        if (!/^[A-Za-z0-9._-]+\.md$/.test(fname)) return res.status(400).json({ error: `Invalid file name: ${fname}` });
        const dest = safePath(base, join(rel, fname));
        if (!dest) return res.status(403).json({ error: 'Path traversal blocked' });
        await mkdir(join(dest, '..'), { recursive: true });
        await writeFile(dest, String(files[fname]), 'utf-8');
      }
      if (kind === 'author' || kind === 'voice') await gateway.soul?.reload?.();
      return res.json({ success: true, kind, wired: WIRED_KINDS.has(kind) });
    } catch (err) {
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });
}
