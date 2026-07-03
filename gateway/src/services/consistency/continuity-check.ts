/**
 * Post-draft continuity detection (Flagship Plan 3, Task 2).
 *
 * Extracts the just-drafted chapter's facts (reuses the same extractor as the
 * full audit), evaluates each against the ledger BEFORE persisting it, then
 * persists so later chapters see it as a prior — this is how the ledger
 * "updates" per chapter during drafting (Task 4 wires this pre-draft/
 * post-draft around a chapter's generation). Idempotent: a chapter's own rows
 * are cleared before re-insert, so re-drafting/retrying a chapter never
 * double-counts its facts.
 *
 * Detection-only for persistence purposes beyond its own chapter: it does not
 * re-run the full audit's canon seeding — that stays runConsistencyAudit's
 * job (Task 6, and the existing project-completion auto-audit hook).
 *
 * Fail-soft throughout: a missing store, an extraction hiccup, or a
 * persistence error never throws — drafting must never be blocked by the
 * continuity checker.
 */
import type { ConsistencyStore } from './fact-store.js';
import type { LedgerFact, KnowledgeEvent, FindingCategory } from './types.js';
import { extractChapterFacts } from './extractor.js';
import { evaluateFact, evaluateKnowledge } from './check-engine.js';
import { CONSISTENCY_PROVIDERS } from './model-selection.js';

/**
 * `red_herring` is reserved but never emitted here: CATEGORY_TO_KIND has no
 * mapping that produces it, and no evaluate* function detects premature
 * reveals. Red-herring / early-reveal protection is handled by PREVENTION —
 * buildCanonBlock's FORBIDDEN MOVES block, injected into the drafting prompt
 * before the chapter is written — not by post-draft detection. Detection is
 * deferred; keep the kind in the type for aggregateActContinuity's shape, but
 * it should not be wired up as a live-but-broken path.
 */
export type ContinuityFlagKind = 'contradiction' | 'timeline' | 'knowledge' | 'red_herring';

export interface ContinuityFlag {
  kind: ContinuityFlagKind;
  detail: string;
  span?: string;
}

const CATEGORY_TO_KIND: Record<FindingCategory, ContinuityFlagKind> = {
  contradiction: 'contradiction',
  'canon-divergence': 'contradiction',
  impossibility: 'contradiction',
  continuity: 'timeline',
  'knowledge-violation': 'knowledge',
};

export async function checkChapter(args: {
  slug: string;
  chapterNumber: number;
  text: string;
  store: ConsistencyStore;
  aiComplete: (r: any) => Promise<{ text: string }>;
  /** Real provider selector (mirrors the bible-seed hook's `aiRouter.selectProvider`)
   *  — this is what makes extraction actually reach a configured model instead of
   *  a stub provider id that the router has never registered. */
  aiSelect: (taskType: string, preferredId?: string) => { id: string };
  /** The book's bound world name, if any (for world-keyed canon scoping). */
  world?: string | null;
  /** Skip persisting this chapter's facts/knowledge (bug-review #22 hazard):
   *  set true when a full/import consistency audit is in flight for this book,
   *  since its clearBookFacts()/clearBookKnowledge() + reinsert would otherwise
   *  race this chapter's own clear+insert and could drop or duplicate ledger
   *  rows. Detection still runs against the current ledger; only the
   *  write-back is skipped. */
  skipPersist?: boolean;
}): Promise<{ flags: ContinuityFlag[] }> {
  const { slug, chapterNumber, text, store, aiComplete, aiSelect } = args;
  const world = args.world ?? null;
  const skipPersist = args.skipPersist === true;
  if (!store?.isAvailable?.() || !text?.trim()) return { flags: [] };

  const chapter = `chapter-${chapterNumber}`;
  const scope = { world, bookSlug: slug };

  let extracted;
  try {
    extracted = await extractChapterFacts(
      {
        ai: {
          complete: aiComplete,
          // Guard against a fallback to a small-context provider (e.g. Ollama)
          // that would truncate the chapter — same guard the bible-seed hook
          // applies to its own selector.
          select: (t: string, pref?: string) => {
            const p = aiSelect(t, pref);
            if (!(CONSISTENCY_PROVIDERS as readonly string[]).includes(p.id)) {
              throw new Error(`Consistency requires a large-context model; "${p.id}" is not supported.`);
            }
            return p;
          },
        },
      },
      text, [], 0,
    );
  } catch {
    return { flags: [] }; // extraction hiccup must never break drafting
  }

  const flags: ContinuityFlag[] = [];

  // Evaluate each new fact against the ledger as it stands BEFORE this
  // chapter's own facts land, then persist.
  const chapterFacts: LedgerFact[] = [];
  for (const f of extracted.facts) {
    const full: LedgerFact = { ...f, world, bookSlug: slug, chapter, storyElapsed: 0 };
    const priors = store.priorFacts(scope, full.entity, full.attribute);
    const finding = evaluateFact(full, priors);
    if (finding) {
      flags.push({ kind: CATEGORY_TO_KIND[finding.category], detail: finding.explanation, span: finding.a?.quote });
    }
    chapterFacts.push(full);
  }
  if (!skipPersist) {
    try {
      store.clearChapterFacts(slug, chapter);
      store.insertFacts(chapterFacts);
    } catch { /* fail-soft: detection result stands even if persistence hiccups */ }
  }

  // Knowledge-timeline check: combine the ledger's prior acquire/use events
  // with this chapter's new ones, then keep only violations first surfaced by
  // THIS chapter's own `use` events.
  const newKnowledge: KnowledgeEvent[] = (extracted.knowledge ?? []).map(k => ({
    ...k, world, bookSlug: slug, chapter,
  }));
  if (newKnowledge.length > 0) {
    try {
      const priorKnowledge = store.knowledgeForBook(scope);
      const kfindings = evaluateKnowledge([...priorKnowledge, ...newKnowledge])
        .filter(kf => kf.a.chapter === chapter);
      for (const kf of kfindings) {
        flags.push({ kind: 'knowledge', detail: kf.explanation, span: kf.a?.quote });
      }
    } catch { /* fail-soft */ }
  }
  // Unconditional (L1): a chapter that HAD knowledge events but was redrafted
  // to have none must still clear its stale rows, mirroring clearChapterFacts
  // above — otherwise a re-draft leaves orphaned knowledge events behind.
  if (!skipPersist) {
    try {
      store.clearChapterKnowledge(slug, chapter);
      if (newKnowledge.length > 0) store.insertKnowledge(newKnowledge);
    } catch { /* fail-soft */ }
  }

  return { flags };
}

/** Per-chapter checkChapter output for one act, keyed by chapter number. */
export interface ActChapterFlags {
  chapterNumber: number;
  flags: ContinuityFlag[];
}

/** Aggregated cross-chapter continuity summary for an act-boundary gate
 *  (Flagship Plan 3, Task 5). Pure aggregation — no I/O — so it can be wired
 *  into whichever gate surface Plan 5 builds without depending on it here. */
export interface ActContinuitySummary {
  totalFlags: number;
  byKind: Record<ContinuityFlagKind, number>;
  /** Only the chapters that actually raised a flag, in input order. */
  chapters: ActChapterFlags[];
}

/** Aggregate a run of per-chapter checkChapter results into one act-boundary
 *  summary. Pure and deterministic. */
export function aggregateActContinuity(perChapter: ActChapterFlags[]): ActContinuitySummary {
  const byKind: Record<ContinuityFlagKind, number> = { contradiction: 0, timeline: 0, knowledge: 0, red_herring: 0 };
  let totalFlags = 0;
  for (const { flags } of perChapter) {
    for (const f of flags) {
      byKind[f.kind]++;
      totalFlags++;
    }
  }
  return { totalFlags, byKind, chapters: perChapter.filter(c => c.flags.length > 0) };
}
