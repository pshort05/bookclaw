import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join, resolve, sep } from 'path';

/**
 * Generic reports subsystem: each analysis engine emits a human-reviewable,
 * downloadable report (.md + .json) under a book's data/reports/, with
 * timestamped history (keep-last-N per kind). Reports are snapshots — a re-run
 * adds a new version. Fail-soft: nothing here throws into a caller.
 */
export type ReportKind = 'consistency' | 'beta-reader' | 'structure' | 'plot-promises';
export const REPORT_KEEP = 10;
export const KIND_LABELS: Record<ReportKind, string> = {
  consistency: 'Consistency', 'beta-reader': 'Beta Reader', structure: 'Structure & Length', 'plot-promises': 'Plot Promises',
};
const KINDS = new Set<string>(Object.keys(KIND_LABELS));
const ID_RE = /^[a-z-]+-\d{8}T\d{6}Z$/;

export interface ReportMeta { id: string; kind: ReportKind; title: string; generatedAt: string; summary: string; formats: Array<'md' | 'json'>; }
interface BooksLike { dataDirOf(slug: string | null): string | null; }
interface IndexFile { reports: ReportMeta[]; }

export class ReportsService {
  constructor(private books: BooksLike) {}

  /** UTC, filesystem-safe stamp: YYYYMMDDTHHMMSSZ. */
  static stamp(d: Date = new Date()): string {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  }

  private dir(slug: string): string | null {
    const data = this.books.dataDirOf(slug);
    return data ? join(data, 'reports') : null;
  }

  private readIndex(dir: string): IndexFile {
    try {
      const raw = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf-8'));
      if (raw && Array.isArray(raw.reports)) return raw as IndexFile;
    } catch { /* fall through to empty */ }
    return { reports: [] };
  }
  private writeIndex(dir: string, idx: IndexFile): void {
    writeFileSync(join(dir, 'index.json'), JSON.stringify(idx, null, 2), 'utf-8');
  }

  write(slug: string, kind: ReportKind, r: { title: string; markdown: string; json: unknown; summary?: string }, timestamp?: string): { id: string } | null {
    try {
      if (!KINDS.has(kind)) return null;
      const dir = this.dir(slug);
      if (!dir) return null;
      mkdirSync(dir, { recursive: true });
      const id = `${kind}-${timestamp ?? ReportsService.stamp()}`;
      if (!ID_RE.test(id)) return null;
      writeFileSync(join(dir, `${id}.md`), r.markdown, 'utf-8');
      writeFileSync(join(dir, `${id}.json`), JSON.stringify(r.json, null, 2), 'utf-8');
      // Reconcile against what is actually on disk, then overlay the persisted
      // index for richer meta (title/summary). This self-heals a lost or corrupt
      // index.json so prune still sees every report — otherwise older files
      // would accumulate unbounded. Add/replace this id, prune, write index once.
      const byId = new Map<string, ReportMeta>();
      for (const m of this.listFromFilenames(dir)) byId.set(m.id, m);
      for (const m of this.readIndex(dir).reports) byId.set(m.id, m);
      byId.set(id, { id, kind, title: r.title, generatedAt: new Date().toISOString(), summary: r.summary ?? '', formats: ['md', 'json'] });
      const kept = this.prune(dir, [...byId.values()]);
      this.writeIndex(dir, { reports: kept });
      return { id };
    } catch (e) {
      console.log(`  ⚠ reports.write(${slug}/${kind}) failed: ${(e as Error)?.message ?? e}`);
      return null;
    }
  }

  // Keep the newest REPORT_KEEP per kind; delete the older ones' files. Pure
  // with respect to the index — returns the kept metas for the caller to persist.
  private prune(dir: string, reports: ReportMeta[]): ReportMeta[] {
    const byKind = new Map<string, ReportMeta[]>();
    for (const m of reports) {
      const arr = byKind.get(m.kind) ?? [];
      arr.push(m);
      byKind.set(m.kind, arr);
    }
    const removeIds = new Set<string>();
    for (const arr of byKind.values()) {
      arr.sort((a, b) => b.id.localeCompare(a.id));
      for (const m of arr.slice(REPORT_KEEP)) removeIds.add(m.id);
    }
    for (const id of removeIds) {
      for (const f of [`${id}.md`, `${id}.json`]) { try { unlinkSync(join(dir, f)); } catch { /* already gone */ } }
    }
    return reports.filter((m) => !removeIds.has(m.id));
  }

  list(slug: string): ReportMeta[] {
    const dir = this.dir(slug);
    if (!dir || !existsSync(dir)) return [];
    let metas = this.readIndex(dir).reports;
    if (metas.length === 0) metas = this.listFromFilenames(dir);
    return metas.slice().sort((a, b) => b.id.localeCompare(a.id));
  }

  private listFromFilenames(dir: string): ReportMeta[] {
    const seen = new Map<string, ReportMeta>();
    let files: string[] = [];
    try { files = readdirSync(dir); } catch { return []; }
    for (const f of files) {
      const m = f.match(/^([a-z-]+)-(\d{8}T\d{6}Z)\.(md|json)$/);
      if (!m || !KINDS.has(m[1])) continue;
      const id = `${m[1]}-${m[2]}`;
      const e = seen.get(id) ?? { id, kind: m[1] as ReportKind, title: KIND_LABELS[m[1] as ReportKind], generatedAt: isoFromStamp(m[2]), summary: '', formats: [] as Array<'md' | 'json'> };
      if (!e.formats.includes(m[3] as 'md' | 'json')) e.formats.push(m[3] as 'md' | 'json');
      seen.set(id, e);
    }
    return [...seen.values()];
  }

  resolvePath(slug: string, id: string, format: 'md' | 'json'): string | null {
    if (format !== 'md' && format !== 'json') return null;
    if (!ID_RE.test(id)) return null;
    const dir = this.dir(slug);
    if (!dir) return null;
    const resolvedBase = resolve(dir);
    const p = resolve(dir, `${id}.${format}`);
    if (p !== resolvedBase && !p.startsWith(resolvedBase + sep)) return null;
    return existsSync(p) ? p : null;
  }
}

function isoFromStamp(stamp: string): string {
  const m = stamp.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : stamp;
}
