/**
 * Prompt Runner file helpers — let the runner target any file under a book's
 * data/ (outputs) or templates/ (snapshots) subtrees by a book-root-relative
 * path, while keeping book.json / .baseline / dotfile sidecars out of reach.
 */
import { existsSync, readdirSync, statSync } from 'fs';
import { join, resolve, sep } from 'path';

export interface RunnerFile { path: string; group: 'Outputs' | 'Templates'; bytes: number; modified: string }

function within(base: string, target: string): boolean {
  const b = resolve(base), t = resolve(target);
  return t === b || t.startsWith(b + sep);
}

/**
 * Map a book-root-relative path (`data/…` or `templates/…`) to its base dir +
 * inner filename, or null if it isn't under those two subtrees or escapes via
 * `..`. The base dir matches the per-subtree version-sidecar location, so data
 * files keep their existing history.
 */
export function mapRunnerPath(bookDir: string, relPath: string): { baseDir: string; filename: string } | null {
  const m = /^(data|templates)\/(.+)$/.exec(relPath || '');
  if (!m) return null;
  const baseDir = join(bookDir, m[1]);
  if (!within(baseDir, join(baseDir, m[2]))) return null;
  return { baseDir, filename: m[2] };
}

/**
 * List a book's runnable files: data/ outputs + templates/ snapshots, each with
 * a book-root-relative path and group. Recurses both subtrees; skips dotfiles
 * (so `.versions` sidecars never appear). Sorted by path.
 */
export function listRunnerFiles(bookDir: string): RunnerFile[] {
  const out: RunnerFile[] = [];
  const walk = (abs: string, relPrefix: string, group: RunnerFile['group']): void => {
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue; // dotfiles + .versions sidecars
      const childAbs = join(abs, e.name);
      const rel = relPrefix + e.name;
      if (e.isDirectory()) { walk(childAbs, rel + '/', group); continue; }
      const st = statSync(childAbs);
      out.push({ path: rel, group, bytes: st.size, modified: st.mtime.toISOString() });
    }
  };
  walk(join(bookDir, 'data'), 'data/', 'Outputs');
  walk(join(bookDir, 'templates'), 'templates/', 'Templates');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Text file kinds accepted by the per-directory upload (book file explorer). */
export const UPLOAD_EXTS = ['.md', '.txt', '.json', '.csv'] as const;

export function isUploadableName(name: string): boolean {
  const ext = '.' + (name.split('.').pop() || '').toLowerCase();
  return (UPLOAD_EXTS as readonly string[]).includes(ext);
}

/**
 * Resolve a per-directory upload target to a confined { baseDir, filename } under
 * the book's data/ or templates/ subtree, or null if it escapes. `dir` is a
 * book-root directory (e.g. "data", "data/chapters", "templates/genre"); `name`
 * is the (already-sanitized) filename. Reuses mapRunnerPath's confinement.
 */
export function resolveBookUpload(bookDir: string, dir: string, name: string): { baseDir: string; filename: string } | null {
  const cleanDir = (dir || '').replace(/\/+$/, '');
  return mapRunnerPath(bookDir, `${cleanDir}/${name}`);
}
