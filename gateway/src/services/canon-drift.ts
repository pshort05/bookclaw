/**
 * Canon Drift Gate — deterministic entity gate + hybrid audit + gate runner.
 *
 * Catches canon-drift errors (an invented town/road proper noun like "Bay Haven",
 * plus semantic contradictions) right after the setting- and character-bible
 * steps, instead of fighting them downstream in the per-chapter audit.
 *
 * The deterministic entity gate is pure (no I/O, no model): it extracts the
 * geographic proper-noun set from the verified anchor(s) and flags any geographic
 * proper noun in the doc that is absent from that set, emitting `swap` edits to the
 * anchor's canonical road/town. It emits the SAME `DeAiEdit[]` shape the shipped
 * `applyDeAiEdits` consumes, so the doc is reconciled by code — never regenerated.
 *
 * Only the gate runner touches services, and only through injected deps (mirrors
 * deterministic-apply.ts's injection style).
 */
import { parseAuditEdits, applyDeAiEdits, type DeAiEdit } from './deterministic-apply.js';

// Cue words (lowercased) that mark a proper noun as a ROAD/way (vs a town or a
// business). Matched either as the run's last token ("Long Beach Boulevard") or as
// a lowercase common-noun cue trailing the run ("Bay Haven boardwalk").
const ROAD_CUES = new Set(['boardwalk', 'boulevard', 'street', 'avenue', 'road', 'way', 'drive', 'lane', 'pier', 'promenade']);
// Cue words that mark a proper noun as a TOWN/place.
const TOWN_CUES = new Set(['city', 'town', 'village', 'island', 'beach', 'harbor', 'bay', 'township', 'shores', 'haven', 'cove']);
// Cue words that mark a proper noun as a BUSINESS (never a place → never flagged).
const BIZ_CUES = new Set(['cafe', 'café', 'bar', 'grill', 'inn', 'diner', 'bakery', 'bookstore', 'shop', 'restaurant', 'tavern', 'pub', 'market', 'motel', 'hotel']);

export interface PlaceSet { towns: string[]; roads: string[] }
export interface EntityConflict { phrase: string; reason: string }
export interface EntityGateResult { edits: DeAiEdit[]; ambiguous: EntityConflict[] }

// A capitalized multi-word proper-noun run: "Long Beach Boulevard", "Surf City".
const RUN_RE = /[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*/g;

// Leading determiners/pronouns are capitalized only at sentence start ("The
// Boardwalk", "Their Cove") and are not part of a place name. Stripping them (a)
// stops a bare cue behind one from reading as a place, and (b) keeps a KNOWN place
// written sentence-initially ("The Surf City …") matching the anchor set instead of
// being flagged as the unknown phrase "The Surf City".
const LEADING_DET_RE = /^(?:(?:The|A|An|This|That|These|Those|Their|Her|His|Its|Our|My|Your)\s+)+/;

function uniq(a: string[]): string[] { return Array.from(new Set(a)); }

function cueClass(tok: string): 'road' | 'town' | 'biz' | null {
  const t = tok.toLowerCase();
  if (ROAD_CUES.has(t)) return 'road';
  if (TOWN_CUES.has(t)) return 'town';
  if (BIZ_CUES.has(t)) return 'biz';
  return null;
}

interface Place { find: string; norm: string; kind: 'road' | 'town' }

/**
 * Every geographic place-phrase occurrence in `text`, in order. A place-phrase is a
 * capitalized proper-noun run whose last token is a road/town cue ("Surf City"), OR
 * a run immediately followed by a lowercase common-noun cue ("Bay Haven boardwalk"
 * → the cue is folded into the phrase). A business cue (as last token or trailing
 * lowercase) disqualifies the run — a fictional business is never a place. `find`
 * is the EXACT substring (preserving whitespace) so a later literal find/replace
 * matches; `norm` collapses whitespace for comparison/reporting.
 */
function scanPlaces(text: string): Place[] {
  const s = String(text ?? '');
  const out: Place[] = [];
  RUN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RUN_RE.exec(s)) !== null) {
    // Drop a leading capitalized determiner ("The Boardwalk" → "Boardwalk") so it
    // pollutes neither the place name nor the known-set match, and advance the phrase
    // start so `find` stays an exact substring.
    const det = LEADING_DET_RE.exec(m[0]);
    const detLen = det ? det[0].length : 0;
    const run = m[0].slice(detLen);
    if (!run) continue;                                // was all determiner (defensive)
    const start = m.index + detLen;
    let end = start + run.length;
    let kind: 'road' | 'town' | null = null;
    // Lookahead: a lowercase common-noun cue immediately trailing the run. Only for
    // a MULTI-WORD run — a genuine invented place needing a common-noun cue is
    // virtually always multi-word ("Bay Haven boardwalk", "Siren Beach"); a lone
    // sentence-initial capital + cue ("Main road", "Beach town") is a common phrase,
    // not a place, and must not be flagged.
    const la = run.includes(' ') ? /^(\s+)([a-z]+)/.exec(s.slice(end)) : null;
    if (la) {
      const c = cueClass(la[2]);
      if (c === 'biz') continue;                       // business → not a place
      if (c === 'road' || c === 'town') {
        kind = c;
        end += la[1].length + la[2].length;            // fold the cue into the phrase
      }
    }
    if (!kind) {
      const toks = run.split(/\s+/);
      const c = cueClass(toks[toks.length - 1]);
      if (c === 'biz' || c === null) continue;         // business or no geographic cue
      // A single bare cue ("Boardwalk", "Island", "Bay") is a common noun, not a
      // place — a real place is name + cue ("Surf City", "Bay Haven"). Require at
      // least a name token before the cue, mirroring the multi-word rule above.
      if (toks.length < 2) continue;
      kind = c;
    }
    const find = s.slice(start, end);
    out.push({ find, norm: find.replace(/\s+/g, ' ').trim(), kind });
  }
  return out;
}

/** The town + road proper-noun sets named in `text`. */
export function extractPlaces(text: string): PlaceSet {
  const towns: string[] = [], roads: string[] = [];
  for (const p of scanPlaces(text)) (p.kind === 'road' ? roads : towns).push(p.norm);
  return { towns: uniq(towns), roads: uniq(roads) };
}

/**
 * Flag every geographic proper noun in `doc` absent from the anchor place-set,
 * emitting one `swap` edit per OCCURRENCE (applyDeAiEdits swaps only the first
 * match per edit, so a phrase appearing twice must yield two edits). An unknown
 * place whose class has no single canonical target in the anchor (0 or >1
 * candidates) is genuinely ambiguous → surfaced separately for the ConfirmationGate,
 * never auto-swapped. Fail-soft: no anchor / empty doc → no edits.
 */
export function entityGate(doc: string, anchors: string[]): EntityGateResult {
  const anchorText = (anchors ?? []).filter(Boolean).join('\n\n');
  const edits: DeAiEdit[] = [];
  const ambiguous: EntityConflict[] = [];
  if (!anchorText.trim() || !String(doc ?? '').trim()) return { edits, ambiguous };

  const ap = extractPlaces(anchorText);
  const known = new Set<string>([...ap.towns, ...ap.roads]);
  const ambigSeen = new Set<string>();

  for (const p of scanPlaces(doc)) {
    if (known.has(p.norm)) continue;
    const targets = p.kind === 'road' ? ap.roads : ap.towns;
    if (targets.length !== 1) {
      if (!ambigSeen.has(p.norm)) {
        ambigSeen.add(p.norm);
        ambiguous.push({ phrase: p.norm, reason: `unknown ${p.kind} "${p.norm}" — anchor has ${targets.length} candidate ${p.kind}s` });
      }
      continue;
    }
    const replace = targets[0];
    edits.push({
      op: 'swap', find: p.find, replace,
      reason: `canon-drift: "${p.norm}" is not in the verified place list; nearest canonical ${p.kind} is ${replace}`,
    });
  }
  return { edits, ambiguous };
}

export interface CanonDriftResult { edits: DeAiEdit[]; ambiguous: EntityConflict[] }

/**
 * Hybrid canon-drift audit: union the deterministic entity gate (A) with the LLM
 * contradiction edits (B). An LLM edit is dropped when its `find` collides with an
 * entity edit (the entity edit wins — it is anchored to the verified place list, the
 * LLM edit is a guess). The entity edits are kept in full: the gate emits ONE edit
 * per occurrence, and `applyDeAiEdits` swaps only the first match per edit, so
 * collapsing same-`find` entity edits (a place repeated verbatim) would leave every
 * occurrence after the first un-reconciled. Ambiguous entity conflicts are returned
 * separately for the ConfirmationGate; they are never auto-applied.
 */
export function canonDriftAudit(
  doc: string,
  anchors: string[],
  llmAuditRaw: string | null | undefined,
): CanonDriftResult {
  const gate = entityGate(doc, anchors);
  const edits: DeAiEdit[] = [...gate.edits];                  // every entity edit (one per occurrence)
  const entityFinds = new Set(gate.edits.map(e => e.find));
  for (const e of parseAuditEdits(llmAuditRaw)) {
    if (!entityFinds.has(e.find)) edits.push(e);              // LLM edit only if it doesn't collide with an entity edit
  }
  return { edits, ambiguous: gate.ambiguous };
}

/** Minimal step shape the gate runner reads (ProjectStep is structurally assignable). */
export interface CanonGateStep { id?: string; skill?: string; role?: string; status: string; result?: string; label?: string }
export interface CanonGateDeps {
  steps: CanonGateStep[];               // all steps of the running project
  step: CanonGateStep;                  // the canon-drift-apply step being executed
  loadAnchors: () => Promise<string[]>; // verified-canon.md + seeds.setting (+ setting bible for Gate B), injected
  rewriteFn?: (span: string, instruction: string) => Promise<string>;
  onAmbiguous?: (conflicts: EntityConflict[], baseDocLabel: string) => Promise<void>; // → ConfirmationGate
  // Rewrite the base canon doc's archival per-step file after canonicalization, so
  // the drifted text is gone from disk too. Injected + fail-soft (in-memory is the
  // downstream source of truth; disk is archival). No-op when omitted.
  persistCanonical?: (step: CanonGateStep, text: string) => Promise<void>;
}
export interface CanonGateOutput {
  text: string; // the gate STEP's own result — a short reconciliation summary, NOT the whole bible
  stats: { swaps: number; rewrites: number; skipped: number; ambiguous: number; noAnchor: boolean; changed: boolean };
}

const done = (s: CanonGateStep) => s.status === 'completed' && !!s.result;

/**
 * The single entry point the dispatch sites call. Resolves the base canon doc (the
 * nearest completed non-audit, non-apply step before this one — the setting bible
 * for Gate A, the character bible for Gate B), the LLM canon-audit result(s), and
 * the injected anchors; runs canonDriftAudit and applies via applyDeAiEdits.
 *
 * Canonicalizes IN PLACE: the reconciled text is written back onto the BASE doc step
 * (`base.result`) — and its archival file via `persistCanonical` — so downstream
 * steps (buildProjectContext reads each completed step's in-memory `result`) see
 * exactly ONE canonical canon doc and the drifted text no longer appears anywhere.
 * The gate step's OWN result (this function's return `text`) is a short summary, so
 * the whole bible isn't duplicated into every later step's context. Fully fail-soft:
 * any missing input → base unchanged, a summary explaining the no-op.
 */
export async function runCanonDriftGate(deps: CanonGateDeps): Promise<CanonGateOutput> {
  const { steps, step } = deps;
  const idx = steps.indexOf(step);
  const before = idx >= 0 ? steps.slice(0, idx) : steps;
  const base = [...before].reverse().find(s =>
    done(s) && !/-audit$/i.test(s.skill ?? '') && (s.skill ?? '') !== 'canon-drift-apply');
  const noop = (summary: string, noAnchor: boolean): CanonGateOutput =>
    ({ text: summary, stats: { swaps: 0, rewrites: 0, skipped: 0, ambiguous: 0, noAnchor, changed: false } });
  if (!base?.result) return noop('Canon gate: no base canon document to reconcile — skipped (no-op).', true);
  const label = base.label ?? 'canon document';

  let anchors: string[] = [];
  try { anchors = await deps.loadAnchors(); } catch { anchors = []; }
  // A doc can never anchor itself: on Gate A the base IS the "Setting" step that
  // loadAnchors also offers, and if the setting bible is its own anchor every place
  // in it reads as "known" and no drift-vs-verified-canon is ever caught. Drop any
  // anchor identical to the base doc so Gate A validates against verified-canon only.
  anchors = anchors.filter(a => a && a !== base.result);
  if (!anchors.join('').trim()) return noop(`Canon gate: no verified anchor for "${label}" — skipped (no-op).`, true);

  // LLM canon-audit result(s) that ran on THIS base doc — i.e. audit steps between the
  // base doc and this apply step. Restricting to after the base index keeps Gate B
  // from re-applying Gate A's (setting) audit edit list against the character bible.
  const baseIdx = steps.indexOf(base);
  const auditScope = baseIdx >= 0 ? steps.slice(baseIdx + 1, idx >= 0 ? idx : steps.length) : before;
  const auditRaw = auditScope
    .filter(s => done(s) && /-canon-audit$/i.test(s.skill ?? ''))
    .map(s => s.result ?? '').join('\n');

  const { edits, ambiguous } = canonDriftAudit(base.result, anchors, auditRaw);
  if (ambiguous.length && deps.onAmbiguous) {
    try { await deps.onAmbiguous(ambiguous, label); } catch { /* fail-soft */ }
  }
  const res = await applyDeAiEdits(base.result, edits, deps.rewriteFn);
  const changed = res.appliedSwaps > 0 || res.appliedRewrites > 0;
  if (changed) {
    base.result = res.text;                              // canonicalize in place (the ONE downstream copy)
    if (deps.persistCanonical) {
      try { await deps.persistCanonical(base, res.text); } catch { /* fail-soft: disk is archival */ }
    }
  }
  const summary = changed
    ? `Canon gate reconciled "${label}": ${res.appliedSwaps} swap(s), ${res.appliedRewrites} rewrite(s), ${res.skipped} skipped, ${ambiguous.length} ambiguous. Canonical text written back to the "${label}" step.`
    : `Canon gate: "${label}" already consistent with the verified anchor (${res.skipped} skipped, ${ambiguous.length} ambiguous).`;
  return {
    text: summary,
    stats: { swaps: res.appliedSwaps, rewrites: res.appliedRewrites, skipped: res.skipped, ambiguous: ambiguous.length, noAnchor: false, changed },
  };
}

/**
 * Finding #5 anchor injection: the block a `*-canon-audit` LLM step needs in its
 * context so the "verified real-world geography anchor in your context" it is told
 * to check against is actually present. Reads `verified-canon.md` from the book's
 * data dir; returns '' for a non-audit step, a book without the anchor, or any I/O
 * error (fully fail-soft — the deterministic entity gate is the hard guard regardless).
 */
export async function canonAuditAnchorBlock(
  skill: string | undefined,
  slug: string | undefined,
  dataDirOf: ((slug: string) => string | null | undefined) | undefined,
): Promise<string> {
  if (!/-canon-audit$/i.test(skill ?? '') || !slug || !dataDirOf) return '';
  try {
    const dir = dataDirOf(slug);
    if (!dir) return '';
    const { existsSync } = await import('fs');
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const vc = join(dir, 'verified-canon.md');
    if (!existsSync(vc)) return '';
    const text = (await readFile(vc, 'utf-8')).trim();
    if (!text) return '';
    return `\n\n## Verified Canon Anchor (reconcile the document TO this — never rewrite the anchor)\n\n${text}\n`;
  } catch { return ''; }
}
