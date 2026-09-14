/**
 * Per-book accepted/declined canon places — the author's answer to an ambiguous
 * canon-drift gate.
 *
 * The `canon-drift-gate` / `reconcile-canon` confirmation asks whether an invented
 * place name ("Bay Haven") is real canon. *Ambiguous* means the gate found no
 * single canonical place to swap to, so "reject" cannot mean "strip the name" —
 * you can't delete a street out of prose and leave a grammatical sentence. So the
 * decision is recorded instead:
 *
 *   Approve → the phrase IS canon for this book. Persisted here and passed to
 *             `entityGate` as a KNOWN phrase (`acceptedPlacePhrases`, never anchor
 *             text — see `entityGate`), so the gate stops flagging it. Nothing else
 *             about the gate changes.
 *   Reject  → not canon. Recorded as declined: the honest record of the author's
 *             choice. No code reads `declined` — rejecting does not alter any later
 *             gate's behaviour, and nothing should claim that it does.
 *
 * Fail-soft throughout: a missing file reads as empty and a write failure is
 * swallowed — a store problem must never fail an approve/reject request. A file that
 * exists but does not parse is moved aside rather than overwritten, so a corrupt
 * store never silently destroys the accepted list.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export const CANON_PLACES_SCHEMA_VERSION = 1;

export type CanonPlaceKind = 'town' | 'road' | 'place';

export interface CanonPlaceEntry {
  phrase: string;
  kind: CanonPlaceKind;
  at: string;   // ISO timestamp of the decision
  by: string;   // who decided (single-user system → "user")
}

export interface CanonPlacesFile {
  schemaVersion: number;
  accepted: CanonPlaceEntry[];
  declined: CanonPlaceEntry[];
}

/** One ambiguous conflict as the canon gate reports it. */
export interface CanonConflictLike { phrase?: string; reason?: string }

export type CanonDecision = 'accepted' | 'declined';

const EMPTY = (): CanonPlacesFile => ({ schemaVersion: CANON_PLACES_SCHEMA_VERSION, accepted: [], declined: [] });

export function canonPlacesPath(bookDir: string): string {
  return join(bookDir, 'canon-places.json');
}

function key(phrase: string): string {
  return String(phrase ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The gate's reason string names the class it scanned: `unknown road "X" — …`. */
function kindOf(conflict: CanonConflictLike): CanonPlaceKind {
  const m = /unknown\s+(town|road)\b/i.exec(String(conflict?.reason ?? ''));
  return m ? (m[1].toLowerCase() as CanonPlaceKind) : 'place';
}

function sanitize(list: unknown): CanonPlaceEntry[] {
  if (!Array.isArray(list)) return [];
  const out: CanonPlaceEntry[] = [];
  for (const e of list) {
    const phrase = String((e as any)?.phrase ?? '').replace(/\s+/g, ' ').trim();
    if (!phrase) continue;
    out.push({
      phrase,
      kind: ((e as any)?.kind === 'town' || (e as any)?.kind === 'road') ? (e as any).kind : 'place',
      at: String((e as any)?.at ?? ''),
      by: String((e as any)?.by ?? 'user'),
    });
  }
  return out;
}

/**
 * Fail-soft read: missing or unreadable → an empty store. Never throws.
 *
 * A file that EXISTS but does not parse is quarantined (renamed aside) before the
 * empty store is returned, because the caller's next decision rewrites the file from
 * whatever this returns — without the quarantine, one corrupt byte would silently
 * delete every place the author had ever accepted.
 */
export function loadCanonPlaces(bookDir: string): CanonPlacesFile {
  const p = canonPlacesPath(bookDir);
  try {
    if (!existsSync(p)) return EMPTY();
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return {
      schemaVersion: Number(j?.schemaVersion) || CANON_PLACES_SCHEMA_VERSION,
      accepted: sanitize(j?.accepted),
      declined: sanitize(j?.declined),
    };
  } catch (err: any) {
    try {
      if (existsSync(p)) {
        const aside = `${p.replace(/\.json$/, '')}.corrupt-${Date.now()}.json`;
        renameSync(p, aside);
        console.log(`  ⚠ canon-places: ${p} is unreadable (${err?.message || err}) — moved to ${aside}; starting a fresh store`);
      }
    } catch { /* fail-soft: a read problem must never fail the caller */ }
    return EMPTY();
  }
}

/** Atomic write (temp + rename, mirrors registry/store.ts). Throws on I/O failure. */
export function saveCanonPlaces(bookDir: string, file: CanonPlacesFile): void {
  const p = canonPlacesPath(bookDir);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2) + '\n');
  renameSync(tmp, p);
}

/**
 * Record the author's decision on a set of ambiguous phrases. De-duplicates by
 * normalized phrase and moves a phrase that was previously decided the other way.
 * Fail-soft: returns the number of phrases persisted (0 on any store error).
 */
export function recordCanonPlaces(
  bookDir: string,
  conflicts: CanonConflictLike[],
  decision: CanonDecision,
  by: string = 'user',
): number {
  try {
    const at = new Date().toISOString();
    const file = loadCanonPlaces(bookDir);
    const other: CanonDecision = decision === 'accepted' ? 'declined' : 'accepted';
    const target = new Map(file[decision].map((e) => [key(e.phrase), e]));
    const opposite = new Map(file[other].map((e) => [key(e.phrase), e]));

    let recorded = 0;
    for (const c of conflicts ?? []) {
      const phrase = String(c?.phrase ?? '').replace(/\s+/g, ' ').trim();
      if (!phrase) continue;
      const k = key(phrase);
      opposite.delete(k);
      if (!target.has(k)) target.set(k, { phrase, kind: kindOf(c), at, by });
      recorded++;
    }
    if (!recorded) return 0;

    saveCanonPlaces(bookDir, {
      schemaVersion: CANON_PLACES_SCHEMA_VERSION,
      accepted: decision === 'accepted' ? [...target.values()] : [...opposite.values()],
      declined: decision === 'declined' ? [...target.values()] : [...opposite.values()],
    });
    return recorded;
  } catch {
    return 0; // a store error must never fail the caller
  }
}

/**
 * The accepted place phrases, for `entityGate`'s `accepted` parameter. Deliberately
 * NOT anchor text: the anchor supplies the candidate swap targets and the
 * "is there an anchor at all" test, so feeding accepted names in that way would let
 * an accept change which swaps the gate makes. As a known-set input it can only
 * stop a phrase being reported. Fail-soft: [] on any store problem.
 */
export function acceptedPlacePhrases(bookDir: string | null | undefined): string[] {
  try {
    if (!bookDir) return [];
    return loadCanonPlaces(bookDir).accepted.map((e) => e.phrase);
  } catch {
    return [];
  }
}

/**
 * Confirmation-gate hook: record the decision behind a `canon-drift-gate` request.
 * A no-op (returns null) for every other confirmation service, a payload with no
 * book or no conflicts, or any store failure — approve/reject must always succeed.
 */
export function applyCanonDriftDecision(
  bookDirOf: (slug: string) => string | null,
  request: { service?: string; payload?: Record<string, any> } | null | undefined,
  decision: CanonDecision,
  by: string = 'user',
): { bookSlug: string; decision: CanonDecision; recorded: number } | null {
  try {
    if (!request || request.service !== 'canon-drift-gate') return null;
    const slug = request.payload?.bookSlug;
    if (typeof slug !== 'string' || !slug) return null;
    const conflicts = request.payload?.conflicts;
    if (!Array.isArray(conflicts) || conflicts.length === 0) return null;
    const dir = bookDirOf(slug);
    if (!dir) return null;
    return { bookSlug: slug, decision, recorded: recordCanonPlaces(dir, conflicts, decision, by) };
  } catch {
    return null;
  }
}
