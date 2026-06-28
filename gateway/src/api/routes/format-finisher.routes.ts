import { Application, Request, Response } from 'express';
import multer from 'multer';
import { existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { SLUG_RE } from '../../services/book-types.js';
import { safePath } from './_shared.js';
import { FinishInputError, DocxParseError, type FinishOptions } from '../../services/format-finisher/index.js';

const isDocxName = (n: string): boolean => /\.docx$/i.test(n);

/**
 * Format Finisher API (Pro publishing last mile). Applies the WritingUtils KDP
 * DOCX finishing transforms to a .docx living under a book's data/|templates/
 * subtree and writes a new finished .docx beside it; also accepts a bring-your-own
 * .docx upload into the book's data/ dir. Behind the same bearer-auth + IP
 * allowlist as the rest of /api/*.
 */
export function mountFormatFinisher(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  // Binary .docx upload into a book's data/ dir (the finisher's input source).
  const docxUploadMw = multer({
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, isDocxName(file.originalname || '')),
    storage: multer.memoryStorage(),
  }).single('file');

  app.post('/api/books/:slug/finish-upload',
    (req: Request, res: Response, next) => docxUploadMw(req, res, (err: unknown) => {
      if (err) return res.status((err as { code?: string })?.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: (err as Error)?.message || 'upload error' });
      next();
    }),
    (req: Request, res: Response) => {
      const slug = String(req.params.slug);
      if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
      const bookDir = services.books?.bookDir(slug);
      if (!bookDir || !existsSync(join(bookDir, 'book.json'))) return res.status(404).json({ error: 'Book not found' });
      const file = (req as unknown as { file?: { originalname: string; buffer: Buffer } }).file;
      if (!file?.buffer) return res.status(400).json({ error: 'a .docx upload (field "file") is required' });
      const name = gateway.sandbox.sanitizeFilename(file.originalname || 'upload.docx').replace(/^\.+/, '').slice(0, 200) || 'upload.docx';
      if (!isDocxName(name)) return res.status(400).json({ error: 'only .docx uploads are accepted' });
      const dataDir = services.books.dataDirOf(slug);
      const target = safePath(dataDir, name);
      if (!target) return res.status(403).json({ error: 'Path traversal blocked' });
      if (existsSync(target)) return res.status(409).json({ error: `A file named "${name}" already exists in data/` });
      try {
        writeFileSync(target, file.buffer);
        res.json({ ok: true, path: `data/${name}` });
      } catch (err) {
        res.status(500).json({ error: (err as Error)?.message || String(err) });
      }
    });

  app.post('/api/books/:slug/format-finish', (req: Request, res: Response) => {
    const svc = services.formatFinisher;
    if (!svc) return res.status(503).json({ error: 'format finisher unavailable' });
    const slug = String(req.params.slug);
    if (!SLUG_RE.test(slug)) return res.status(400).json({ error: 'invalid slug' });
    const bookDir = services.books?.bookDir(slug);
    if (!bookDir || !existsSync(join(bookDir, 'book.json'))) return res.status(404).json({ error: 'Book not found' });
    const path = String(req.body?.path ?? '');
    if (!path) return res.status(400).json({ error: 'path is required (a .docx under data/ or templates/)' });
    const options = (req.body?.options ?? {}) as FinishOptions;
    try {
      res.json(svc.finishBookFile(slug, path, options));
    } catch (err) {
      if (err instanceof FinishInputError) return res.status(400).json({ error: err.message });
      if (err instanceof DocxParseError) return res.status(422).json({ error: `could not read .docx: ${err.message}` });
      res.status(500).json({ error: (err as Error)?.message || String(err) });
    }
  });
}
