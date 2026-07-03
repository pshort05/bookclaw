/**
 * Pre-draft continuity injection (Flagship Plan 3, Task 1).
 *
 * Composes the ConsistencyStore's ledger into a prompt block for the chapter
 * about to be drafted: established facts up to `chapterNumber` ("CONTINUITY
 * LEDGER"), who-knows-what as of that point ("CHARACTER KNOWLEDGE MATRIX" —
 * the Character Knowledge Matrix built during the deep-continuity-engine
 * expansion), and a "FORBIDDEN MOVES" list of facts the ledger already has
 * from a LATER chapter (already-drafted-ahead content, or a re-audit) so the
 * model doesn't foreshadow/spoil them early — entity/attribute only, never
 * the value itself.
 *
 * Selective Exclusion (dream/flashback/hypothetical scenes) is already baked
 * into the store's `canonical = 1` filter (factsForBook/priorFacts), so
 * nothing here needs a separate toggle for it.
 */
import type { ConsistencyStore } from './fact-store.js';
import type { LedgerFact } from './types.js';

const SECTION_CAP = 4000; // chars per section — keep the prompt bounded (mirrors book-canon.ts)
function cap(s: string, n = SECTION_CAP): string {
  return s.length > n ? s.slice(0, n) + '\n…[truncated]' : s;
}

/** A ledger chapter label's numeric ordinal (e.g. "chapter-5" -> 5). Non-numeric
 *  labels (CANON, prologue, an imported book's slugged heading, …) return null
 *  and are treated as always-in-scope background rather than a future chapter. */
function chapterOrdinal(label: string): number | null {
  const m = String(label ?? '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

export function buildCanonBlock(args: {
  slug: string;
  chapterNumber: number;
  store: ConsistencyStore;
  /** The book's bound world name, if any (for world-keyed canon scoping). */
  world?: string | null;
}): string {
  const { slug, chapterNumber, store } = args;
  const world = args.world ?? null;
  if (!store?.isAvailable?.()) return '';

  const scope = { world, bookSlug: slug };
  const facts = store.factsForBook(scope);
  if (facts.length === 0) return '';

  const known: LedgerFact[] = [];
  const forbidden: LedgerFact[] = [];
  for (const f of facts) {
    const n = chapterOrdinal(f.chapter);
    if (n === null || n <= chapterNumber) known.push(f);
    else forbidden.push(f);
  }

  const parts: string[] = [];
  if (known.length > 0) {
    parts.push('## CONTINUITY LEDGER — established facts; do not contradict');
    parts.push(cap(known.map(f => `- ${f.entity}.${f.attribute}: ${f.valueRaw} (${f.chapter})`).join('\n')));
  }

  const knowledge = store.knowledgeForBook(scope)
    .filter(k => k.canonical && k.kind === 'acquire')
    .filter(k => { const n = chapterOrdinal(k.chapter); return n === null || n <= chapterNumber; });
  if (knowledge.length > 0) {
    const byKnower = new Map<string, Set<string>>();
    for (const k of knowledge) {
      const attr = k.factKey.split('\0')[1] ?? k.factKey;
      if (!byKnower.has(k.knower)) byKnower.set(k.knower, new Set());
      byKnower.get(k.knower)!.add(attr);
    }
    parts.push('\n## CHARACTER KNOWLEDGE MATRIX — what each character knows as of this chapter');
    parts.push(cap([...byKnower.entries()].map(([who, attrs]) => `- ${who}: ${[...attrs].join(', ')}`).join('\n')));
  }

  if (forbidden.length > 0) {
    parts.push('\n## FORBIDDEN MOVES — established in a LATER chapter; do not reveal or foreshadow yet');
    parts.push(cap(forbidden.map(f => `- ${f.entity}.${f.attribute} (${f.chapter})`).join('\n')));
  }

  return parts.length > 0 ? parts.join('\n') : '';
}
