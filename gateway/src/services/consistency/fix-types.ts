/**
 * Shared types for the consistency apply-fix feature. The contract source for the
 * propose/apply routes, the MCP tools, and the frontend. See
 * docs/superpowers/specs/2026-06-26-consistency-apply-fix-design.md (§5).
 */
import type { FindingCategory } from './types.js';

/**
 * Finding categories that are phrase-swappable, i.e. fixable by a surgical
 * find/replace. `knowledge-violation` is excluded — it needs a plot change, not a
 * phrase swap. `canon-divergence` always edits the prose to match the bible.
 */
// Keep in sync with FIXABLE_CATEGORIES in frontend/studio/src/lib/consistencyApi.ts
// (cross-package; the studio can't import gateway TS).
export const FIXABLE: readonly FindingCategory[] = [
  'contradiction',
  'continuity',
  'impossibility',
  'canon-divergence',
] as const;

/** A model-proposed edit returned by the propose step (preview, no write). */
export interface ProposedEdit {
  findingId: string;
  category: string;
  entity: string;
  attribute: string;
  canonicalValue: string;
  /** Chapter label of the chapter whose prose is edited. */
  targetChapter: string;
  oldPhrase: string;
  newPhrase: string;
  note: string;
  /** True when oldPhrase anchors exactly+uniquely in the target chapter's prose. */
  anchored: boolean;
}

/** The exact edits the author confirmed, sent to the apply step. */
export interface ConfirmedEdit {
  findingId: string;
  targetChapter: string;
  oldPhrase: string;
  newPhrase: string;
}

/** Skip reasons: anchor failed (`not-found`/`ambiguous`), the edit didn't match a
 * server-generated proposal (`unverified`), or the resolved path was unsafe
 * (`path-blocked`). */
export type SkipReason = 'not-found' | 'ambiguous' | 'unverified' | 'path-blocked';

/** Result of an apply: what was written and what was skipped (with reason). */
export interface ApplyOutcome {
  applied: { findingId: string; targetChapter: string; oldPhrase: string; newPhrase: string }[];
  skipped: { findingId: string; targetChapter: string; oldPhrase: string; reason: SkipReason }[];
}
