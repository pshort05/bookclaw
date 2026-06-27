import { createHash } from 'crypto';
import type { ConsistencyFinding } from './types.js';

/**
 * Deterministic, stable identifier for a consistency finding. A sha256 hex over a
 * canonical join of the finding's identifying fields, truncated to 16 chars. Pure:
 * the same finding always yields the same id, and findings differing in any of the
 * joined fields yield distinct ids — so the UI and the fix endpoints can reference
 * a finding across the propose/apply round-trip without re-running the audit.
 *
 * The `b` side is either a chapter ref (has `chapter`) or a canon ref (has
 * `canonSource`); we fold whichever is present so a manuscript-vs-manuscript and a
 * manuscript-vs-canon finding for the same attribute don't collide.
 */
export function computeFindingId(f: ConsistencyFinding): string {
  const bAnchor = 'chapter' in f.b ? f.b.chapter : f.b.canonSource;
  const parts = [
    f.category,
    f.entity,
    f.attribute,
    f.a.chapter,
    String(f.a.scene),
    f.a.quote,
    bAnchor,
    f.b.quote,
  ];
  // JSON.stringify (not a raw '|' join) so a literal pipe inside a quote/entity
  // can't shift field boundaries and collide two distinct findings to one id.
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}
