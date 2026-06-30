/**
 * Shared utilities for the split route mounters.
 *
 * safePath, the multer upload instance, the Wave-3 disclaimer header, and a
 * baseDir-factory for gatherChapters — all hoisted out of routes.ts so the
 * per-feature mounters can share them (one-way dep: routes.ts -> mounters).
 */
import path from 'path';
import multer from 'multer';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wrap an async Express handler so a rejected promise is routed to next(err)
 * (and thence the error middleware) instead of becoming an unhandled rejection.
 * Express 4 does NOT await/await-catch async handlers itself, and Node 22
 * terminates the process on an unhandled rejection — so any unguarded `await`
 * that rejects inside a route would otherwise crash the whole gateway. Apply
 * this to mutating async handlers that don't already have a try/catch.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
): RequestHandler {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/**
 * Shared preamble for confirmation-gated "finalize" handlers. Looks up the
 * confirmation by id, verifies it belongs to the expected service, and requires
 * it to be in the `approved` state. Returns a discriminated result so callers
 * keep their own finalize action while sharing the (previously hand-rolled,
 * drifted) lookup/validation logic and consistent 404/409 mappings.
 *
 *   const gate = requireApprovedConfirmation(services.confirmationGate, { id, expectedService: 'book-transfer' });
 *   if (!gate.ok) return res.status(gate.status).json({ error: gate.error });
 *   // ... finalize using gate.request.payload ...
 */
export function requireApprovedConfirmation(
  confirmationGate: any,
  opts: { id: string; expectedService: string },
):
  | { ok: true; request: any }
  | { ok: false; status: number; error: string } {
  const { id, expectedService } = opts;
  if (!id) return { ok: false, status: 400, error: 'confirmationId required' };
  const { status, request } = confirmationGate.checkDecision(id);
  if (!request || request.service !== expectedService) {
    return { ok: false, status: 404, error: 'no such confirmation' };
  }
  if (status !== 'approved') {
    return { ok: false, status: 409, error: `confirmation is ${status} (must be approved)` };
  }
  return { ok: true, request };
}

/** Verify resolved path stays within the allowed base directory. */
export function safePath(base: string, userInput: string): string | null {
  const resolved = path.resolve(base, userInput);
  const resolvedBase = path.resolve(base);
  if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) return null;
  return resolved;
}

/**
 * Stream a stored file to the client with XSS-safe headers (file-explorer read
 * endpoints). A user-supplied file is NEVER served with an active MIME type on
 * the app origin: inert previewable text (md/txt/json/…) goes out as
 * `text/plain; charset=utf-8` inline; everything else (and any `download`) is
 * forced to `application/octet-stream` + `Content-Disposition: attachment`.
 * `X-Content-Type-Options: nosniff` is always set so the browser can't sniff a
 * payload up to an active type. Caller must validate the path first (safePath).
 */
export async function serveFile(res: Response, filePath: string, filename: string, download = false): Promise<void> {
  const { createReadStream } = await import('fs');
  const { isPreviewableText } = await import('../../services/file-preview.js');
  const safeName = filename.replace(/[\r\n"]/g, '');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!download && isPreviewableText(filename)) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  }
  createReadStream(filePath)
    .on('error', () => { try { res.destroy(); } catch {} })
    .pipe(res);
}

/** Shared multer instance: 50MB limit, .txt/.md/.docx only, in-memory storage. */
export const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max (up from 10MB for novel uploads)
  fileFilter: (_req, file, cb) => {
    const allowed = ['.txt', '.md', '.docx'];
    const ext = '.' + (file.originalname.split('.').pop() || '').toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type "${ext}" not supported. Use .txt, .md, or .docx`));
    }
  },
  storage: multer.memoryStorage(),
});

/** Multer for .zip book imports — 200MB, .zip only, in-memory. */
export const uploadZip = multer({
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.originalname.toLowerCase().endsWith('.zip')
      || file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed';
    if (ok) cb(null, true); else cb(new Error('Only .zip files are supported'));
  },
  storage: multer.memoryStorage(),
});

/**
 * Resolve the effective AI provider + model + temperature for executing a
 * project step, for passing to handleMessage(..., preferredProvider,
 * overrideModel, bookSlug, overrideTemperature).
 * Precedence: the step's own modelOverride wins; otherwise the project-level
 * preferredProvider applies; model and temperature are pinned only when the
 * step sets them.
 * Returns undefined fields when nothing is pinned (→ tier routing, today's
 * default behavior).
 */
export function stepRouting(
  project: any,
  step: any
): { provider: string | undefined; model: string | undefined; temperature: number | undefined } {
  return {
    provider: step?.modelOverride?.provider || project?.preferredProvider || undefined,
    model: step?.modelOverride?.model || project?.preferredModel || undefined,
    temperature: typeof step?.modelOverride?.temperature === 'number'
      ? step.modelOverride.temperature
      : undefined,
  };
}

/** Sets the Wave-3 advisory header on a response. */
export function addWaveDisclaimer(res: Response): void {
  res.setHeader('X-BookClaw-Disclaimer', 'Wave 3 actions create confirmation requests but do not execute irreversible actions autonomously. You are responsible for every approved action. See SECURITY.md.');
}

/**
 * Build a gatherChapters(project) closed over baseDir (call sites stay unchanged).
 *
 * Phase 8: chapter step files live in the project's bound book data/ dir (named
 * `${project.id}-step-N-...md`).  Pass `dataDirResolver` so the reader resolves
 * the dir from the project's bookSlug first, then falls back to the global active
 * book resolver, then to the legacy per-project `workspace/projects/<slug>/`.
 * The `${ws.id}-` file-name prefix already scopes the on-disk read to this
 * project's steps, so sibling projects sharing the book dir never leak in.
 *
 * @param dataDirResolver  Receives the project; returns the resolved data dir or
 *   null.  For Phase 8 callers, pass
 *   `(p) => services.books?.dataDirOf?.(p.bookSlug) ?? services.books?.activeDataDir?.() ?? null`.
 */
export function makeGatherChapters(baseDir: string, dataDirResolver?: (project: any) => string | null) {
  return async function gatherChapters(project: any): Promise<Array<{ id: string; number: number; title: string; text: string }>> {
    const { join: j } = await import('path');
    const { readFile: rf } = await import('fs/promises');
    const { existsSync: ex } = await import('fs');

    const projectSlug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let activeDataDir: string | null = null;
    try { activeDataDir = dataDirResolver?.(project) ?? null; } catch { activeDataDir = null; }
    const projectDir = activeDataDir ?? j(baseDir, 'workspace', 'projects', projectSlug);

    const writingSteps = project.steps
      .filter((s: any) => (s.phase === 'writing' || s.label?.toLowerCase().includes('chapter')) && s.status === 'completed')
      .sort((a: any, b: any) => (a.chapterNumber || 0) - (b.chapterNumber || 0));

    const chapters: Array<{ id: string; number: number; title: string; text: string }> = [];
    for (const ws of writingSteps) {
      let text = ws.result || '';
      // If no inline result, try reading from disk.
      if (!text && ex(projectDir)) {
        const expectedFile = `${ws.id}-${ws.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
        const fullPath = j(projectDir, expectedFile);
        if (ex(fullPath)) {
          const raw = await rf(fullPath, 'utf-8');
          text = raw.replace(/^# .+\n\n/, '');
        }
      }
      if (text && text.length > 200) {
        chapters.push({
          id: ws.id,
          number: ws.chapterNumber || chapters.length + 1,
          title: ws.label,
          text,
        });
      }
    }
    return chapters;
  };
}
