/**
 * Types + constants for the book entity (book-container Phase 2).
 *
 * A book is a self-contained directory: book.json manifest + templates/ snapshot
 * + data/ outputs. schemaVersion gates compatibility (fail-closed per book).
 */

/** Bump ONLY when book.json / the container layout changes in a breaking way. */
export const BOOK_SCHEMA_VERSION = 1;
/** Oldest book schema this app can open without migration. */
export const BOOK_MIN_SUPPORTED = 1;

/** Gate outcome for a book on open. */
export type BookStatus = 'ok' | 'readonly' | 'quarantined';

/** Provenance for one snapshotted component. */
export interface PulledRef {
  name: string;
  source: 'builtin' | 'workspace' | 'synthetic';
  version?: number; // pipelines carry one; prose templates don't
}

export interface BookManifest {
  id: string;                 // stable id (= slug at creation)
  slug: string;               // dir name under workspace/books/
  title: string;
  schemaVersion: number;      // THE compatibility gate
  createdByApp: string;       // provenance only — never gates
  lastWrittenByApp: string;   // provenance only
  phase: 'planning' | 'bible' | 'production' | 'revision' | 'format' | 'launch';
  createdAt: string;          // ISO
  pulledFrom: {
    author: PulledRef;
    voice?: PulledRef;
    genre?: PulledRef | null;
    pipeline: PulledRef;
    sections: string[];       // section names snapshotted
    skills?: string[];        // pipeline-referenced skill names snapshotted (frozen record)
  };
  history: Array<{ at: string; event: string; detail?: string }>;
}

/** A book + its computed gate status (status is not stored in book.json). */
export interface BookSummary {
  slug: string;
  title: string;
  phase: string;
  schemaVersion: number;
  status: BookStatus;
  createdAt: string;
  // byline (book-container Phase 6c) — names only, from the manifest's pulledFrom snapshot
  author?: string;
  voice?: string;
  genre?: string | null;
}

/** Classify a stored schemaVersion against this app's supported range. */
export function classifyVersion(v: number): BookStatus {
  if (v < BOOK_MIN_SUPPORTED) return 'quarantined'; // too old for this app
  if (v > BOOK_SCHEMA_VERSION) return 'readonly';    // written by a newer app
  return 'ok';
}

/** Snapshot kinds that currently DRIVE generation (author+voice via SoulService, pipeline via the engine). genre/sections/skills are stored records, not yet injected. */
export const WIRED_KINDS: ReadonlySet<string> = new Set(['author', 'voice', 'pipeline']);

/** A single .md filename (no path separators) allowed inside a multi-file template entry. */
export const MD_FILE_RE = /^[A-Za-z0-9._-]+\.md$/;

/** A filesystem-safe slug / entry name: lowercase alnum + hyphen, leading alnum. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Parse + shape-validate a pipeline JSON string. Throws on invalid. Returns the parsed object. */
export function parsePipelineJson(raw: string): { steps: unknown[]; schemaVersion: number; [k: string]: unknown } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('pipeline content must be valid JSON'); }
  const p = parsed as { steps?: unknown; schemaVersion?: unknown };
  if (!Array.isArray(p.steps) || typeof p.schemaVersion !== 'number') {
    throw new Error('pipeline JSON must have a steps array and a numeric schemaVersion');
  }
  return parsed as { steps: unknown[]; schemaVersion: number; [k: string]: unknown };
}

/** Derive a filesystem-safe slug from a title. Never returns ''. */
export function slugify(title: string): string {
  const base = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base || 'book';
}
