/**
 * BookClaw Reader Panel Service
 *
 * Simulates a panel of reader personas ranking/scoring candidate marketing
 * copy (blurbs, hooks, titles, opening pages) with anti-slop guards against
 * LLM-judge collapse. Distinct from beta-reader.ts (which critiques
 * manuscript prose chapter-by-chapter): this service judges short
 * marketing/craft CANDIDATES against each other, not a manuscript.
 *
 * Ported (adapted) from the AuthorAgent fork's synthetic reader-panel
 * tournament service (`gateway/src/services/reader-panel.ts` on
 * `authoragent/main`). The fork runs a full pairwise single-elim/swiss
 * tournament with genre-parameterized persona generation. This port keeps
 * the same anti-slop safeguards — position-bias order swap, score-clustering,
 * Jaccard near-duplicate-rationale detection, aggregate confidence — but
 * simplifies to a single batched "all personas judge all candidates" AI call
 * (plus one reversed-candidate-order call for the bias check), to fit the
 * caller-supplied `ReaderPersona[]` interface used elsewhere in this repo
 * instead of the fork's internal genre/demographic persona generator.
 *
 * Per-call AI functions (aiComplete/aiSelectProvider), not constructor
 * injection — mirrors beta-reader.ts.
 */

export type PanelKind = 'blurb' | 'hook' | 'title' | 'opening';
export type PanelFormat = 'rank' | 'score';

export interface ReaderPersona {
  id: string;
  label: string;
  /** The angle this persona judges from, e.g. "price-sensitive browsing reader". */
  lens: string;
}

export interface CandidateRanking {
  candidate: string;
  /** Index into the original `candidates` array passed to runPanel. */
  index: number;
  /** 0-1 normalized preference score, averaged across the persona panel. */
  score: number;
  rationale: string;
}

export interface PanelReport {
  kind: PanelKind;
  format: PanelFormat;
  /** Sorted best (highest score) to worst. */
  rankings: CandidateRanking[];
  /** Index into the original `candidates` array of the top-ranked candidate. */
  winnerIndex: number;
  /** 0-1 aggregate confidence, penalized by the anti-slop guards below. */
  confidence: number;
  /** Anti-slop + operational warnings surfaced to the caller. */
  notes: string[];
}

export type AICompleteFn = (request: {
  provider: string;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
}) => Promise<{ text: string }>;

export type AISelectProviderFn = (taskType: string) => { id: string };

const KIND_FRAMING: Record<PanelKind, string> = {
  blurb: 'back-cover blurb / product description',
  hook: 'marketing hook or opening line',
  title: 'book title',
  opening: 'opening page (first few paragraphs)',
};

// runPanel() has no `format` parameter (per the interface), so the format is
// derived from `kind`: short, easily-compared candidates (titles/hooks) rank
// well; longer copy (blurbs/openings) is scored on its own merits, which
// pairwise ranking answers less directly for absolute buy-in.
const KIND_DEFAULT_FORMAT: Record<PanelKind, PanelFormat> = {
  title: 'rank',
  hook: 'rank',
  blurb: 'score',
  opening: 'score',
};

/** Default panel used when the caller doesn't supply personas. */
export const DEFAULT_PERSONAS: ReaderPersona[] = [
  { id: 'p1', label: 'Plot-First Page-Turner', lens: 'wants a fast hook and clear stakes; judges on whether this would make them keep reading' },
  { id: 'p2', label: 'Character-First Emotional Reader', lens: 'wants to feel something and connect with a person; judges on emotional pull' },
  { id: 'p3', label: 'Voice-First Prose Reader', lens: 'notices the writing itself; judges on voice and specificity over generic phrasing' },
  { id: 'p4', label: 'Price-Sensitive Browsing Reader', lens: 'skims quickly while browsing; judges on whether this stands out enough to be worth the price' },
  { id: 'p5', label: 'Genre-Fan Trope Reader', lens: 'reads widely in this genre and knows its tropes; judges on whether this signals the right genre promise' },
];

function buildSystemPrompt(kind: PanelKind, format: PanelFormat): string {
  const framing = KIND_FRAMING[kind];
  const task = format === 'rank'
    ? 'rank the candidates from BEST to WORST — the one that would make THAT reader buy/click/keep-reading first'
    : 'score EACH candidate 1-10 for how likely THAT reader is to buy/click/keep-reading';
  return `You are simulating a panel of real readers evaluating candidate ${framing}s for the SAME book. For each persona below, ${task}, judged strictly through that persona's stated lens — not as a marketer or editor.

Rules:
1. Judge as the persona, not as a marketer. Use the lens described for each persona.
2. Give ONE short, specific reason per persona (max ~20 words) — never generic ("it's catchier"). Reference what in the copy pulled or lost them.
3. Judge every persona independently; do not default to always preferring the first- or last-listed candidate.

Return ONLY valid JSON, no markdown fences.`;
}

interface PersonaVote {
  personaId: string;
  reason: string;
  /** 0-1 normalized preference, one entry per SHOWN candidate position. */
  scoresByShownIndex: number[];
}

/**
 * Run ONE batched AI call: every persona judges every candidate in the given
 * (shown) order. Returns normalized 0-1 scores per shown position so 'rank'
 * and 'score' formats aggregate identically downstream.
 */
async function runPass(
  shownCandidates: string[],
  panel: ReaderPersona[],
  format: PanelFormat,
  providerId: string,
  systemPrompt: string,
  aiComplete: AICompleteFn,
): Promise<PersonaVote[]> {
  const n = shownCandidates.length;
  const candidateBlock = shownCandidates.map((c, i) => `${i}: ${c}`).join('\n');
  const personaBlock = panel.map((p) => `- ${p.id} (${p.label}): ${p.lens}`).join('\n');
  const instructions = format === 'rank'
    ? '"ranking": an array of ALL candidate indices, BEST to WORST (e.g. [2,0,1]).'
    : '"scores": an array with one 1-10 integer score per candidate index, in order (e.g. [7,4,9]).';
  const userPrompt =
    `CANDIDATES (0-indexed):\n${candidateBlock}\n\n` +
    `PERSONAS:\n${personaBlock}\n\n` +
    `For each persona return ${instructions} Also give ONE short reason (max ~20 words) grounded in that persona's lens.\n\n` +
    `Return ONLY valid JSON, no markdown fences, in this exact shape:\n` +
    `{"personaVotes":[{"personaId":"p1",${format === 'rank' ? '"ranking":[...]' : '"scores":[...]'},"reason":"..."}]}\n` +
    `One entry per persona, in order.`;

  let raw = '';
  try {
    const resp = await aiComplete({
      provider: providerId,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: Math.max(800, panel.length * 150 + 400),
      temperature: 0.6,
    });
    raw = resp.text || '';
  } catch {
    return [];
  }

  const parsed = parseJson(raw);
  const rawVotes = Array.isArray(parsed?.personaVotes) ? parsed.personaVotes : [];
  const out: PersonaVote[] = [];
  for (const v of rawVotes) {
    const personaId = typeof v?.personaId === 'string' ? v.personaId : '';
    if (!personaId) continue;
    const reason = typeof v?.reason === 'string' ? v.reason.trim() : '';
    let scoresByShownIndex: number[];
    if (format === 'rank') {
      const ranking = Array.isArray(v?.ranking) ? v.ranking.map((x: any) => Number(x)) : [];
      const valid = ranking.length === n
        && new Set(ranking).size === n
        && ranking.every((x: number) => Number.isInteger(x) && x >= 0 && x < n);
      if (!valid) continue;
      scoresByShownIndex = new Array(n).fill(0);
      ranking.forEach((shownIdx: number, pos: number) => {
        scoresByShownIndex[shownIdx] = n > 1 ? (n - 1 - pos) / (n - 1) : 1;
      });
    } else {
      const scores = Array.isArray(v?.scores) ? v.scores.map((x: any) => Number(x)) : [];
      if (scores.length !== n || scores.some((x: number) => !Number.isFinite(x))) continue;
      scoresByShownIndex = scores.map((s: number) => Math.max(0, Math.min(1, (Math.max(1, Math.min(10, s)) - 1) / 9)));
    }
    out.push({ personaId, reason, scoresByShownIndex });
  }
  return out;
}

/** Average per-persona shown-index scores back into original candidate indices. */
function aggregateScores(
  votes: PersonaVote[],
  n: number,
  mapShownToOrig: (shownIndex: number) => number,
): { avg: number[]; top: Array<{ reason: string; topOrigIndex: number }> } {
  const sums = new Array(n).fill(0);
  const counts = new Array(n).fill(0);
  const top: Array<{ reason: string; topOrigIndex: number }> = [];
  for (const v of votes) {
    let bestShown = 0;
    for (let i = 1; i < v.scoresByShownIndex.length; i++) {
      if (v.scoresByShownIndex[i] > v.scoresByShownIndex[bestShown]) bestShown = i;
    }
    for (let i = 0; i < v.scoresByShownIndex.length; i++) {
      const orig = mapShownToOrig(i);
      sums[orig] += v.scoresByShownIndex[i];
      counts[orig] += 1;
    }
    top.push({ reason: v.reason, topOrigIndex: mapShownToOrig(bestShown) });
  }
  const avg = sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : 0));
  return { avg, top };
}

function argmaxIndex(arr: number[]): number {
  let best = 0;
  for (let i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
  return best;
}

/** Build a candidate's rationale from the reasons of personas whose top pick was it. */
function buildRationale(origIndex: number, contributing: Array<{ reason: string; topOrigIndex: number }>): string {
  const reasons = contributing.filter((r) => r.topOrigIndex === origIndex && r.reason).map((r) => r.reason);
  const deduped: string[] = [];
  const sets: Set<string>[] = [];
  for (const r of reasons) {
    const ts = tokenSet(r);
    if (sets.some((s) => jaccard(s, ts) >= 0.7)) continue;
    deduped.push(r);
    sets.push(ts);
    if (deduped.length >= 2) break;
  }
  return deduped.join('; ');
}

// ── Anti-slop helpers (Jaccard near-duplicate detection, ported verbatim
// from the fork's repetitionScore/tokenSet/jaccard). ──

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'as',
  'is', 'it', 'this', 'that', 'with', 'i', 'me', 'my', 'more', 'than', 'so',
  'would', 'their', 'them', 'they', 'reader', 'readers', 'book', 'candidate',
]);

function tokenSet(text: string): Set<string> {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Fraction of reason pairs that are near-duplicates (Jaccard >= 0.6). */
function repetitionScore(reasons: string[]): { ratio: number; duplicatePairs: number } {
  const cleaned = reasons.map((r) => tokenSet(r)).filter((s) => s.size > 0);
  if (cleaned.length < 2) return { ratio: 0, duplicatePairs: 0 };
  let dup = 0;
  let total = 0;
  for (let i = 0; i < cleaned.length; i++) {
    for (let j = i + 1; j < cleaned.length; j++) {
      total++;
      if (jaccard(cleaned[i], cleaned[j]) >= 0.6) dup++;
    }
  }
  return { ratio: total > 0 ? dup / total : 0, duplicatePairs: dup };
}

/** Defensive JSON parse (mirrors beta-reader.ts / the fork's approach). */
function parseJson(raw: string): any {
  const cleaned = String(raw || '').replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const slice = cleaned.substring(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    try {
      return JSON.parse(slice.replace(/,\s*([}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════

export class ReaderPanelService {
  /**
   * Run the panel over `candidates` for the given `kind`.
   *
   * Cost: 2 AI calls total — one batched call with candidates in their
   * given order, one with the order reversed (the position-bias guard).
   * Every persona votes in each call.
   */
  async runPanel(
    kind: PanelKind,
    candidates: string[],
    personas: ReaderPersona[] | undefined,
    aiComplete: AICompleteFn,
    aiSelectProvider: AISelectProviderFn,
  ): Promise<PanelReport> {
    const clean = (candidates || []).map((c) => String(c ?? '').trim()).filter(Boolean);
    const format: PanelFormat = KIND_DEFAULT_FORMAT[kind] ?? 'rank';

    if (clean.length < 2) {
      return {
        kind,
        format,
        rankings: clean.map((c, i) => ({ candidate: c, index: i, score: 0, rationale: '' })),
        winnerIndex: 0,
        confidence: 0,
        notes: ['Need at least 2 candidates to run a reader panel. Provide 2 or more.'],
      };
    }

    const panel = personas && personas.length > 0 ? personas : DEFAULT_PERSONAS;
    const provider = aiSelectProvider('marketing');
    const systemPrompt = buildSystemPrompt(kind, format);
    const n = clean.length;

    // Position-bias mitigation: run the FULL panel twice, once in the given
    // order and once with the candidate order reversed. A fair panel should
    // pick the same winner either way; if it doesn't, the model is judging
    // by list position, not content — discard the reversed pass and flag
    // low confidence rather than silently averaging in a biased signal.
    const votesA = await runPass(clean, panel, format, provider.id, systemPrompt, aiComplete);
    const reversedCandidates = [...clean].reverse();
    const votesB = await runPass(reversedCandidates, panel, format, provider.id, systemPrompt, aiComplete);

    const { avg: scoreA, top: topA } = aggregateScores(votesA, n, (i) => i);
    const { avg: scoreB, top: topB } = aggregateScores(votesB, n, (i) => n - 1 - i);

    const hasA = votesA.length > 0;
    const hasB = votesB.length > 0;
    const winnerA = hasA ? argmaxIndex(scoreA) : -1;
    const winnerB = hasB ? argmaxIndex(scoreB) : -1;
    const positionBiasFlag = hasA && hasB && winnerA !== winnerB;

    let finalScore: number[];
    let contributing: Array<{ reason: string; topOrigIndex: number }>;
    if (hasA && hasB && !positionBiasFlag) {
      finalScore = scoreA.map((s, i) => (s + scoreB[i]) / 2);
      contributing = [...topA, ...topB];
    } else if (hasA) {
      finalScore = scoreA;
      contributing = topA;
    } else if (hasB) {
      finalScore = scoreB;
      contributing = topB;
    } else {
      finalScore = new Array(n).fill(0);
      contributing = [];
    }

    const notes: string[] = [];
    let confidence: number;
    if (!hasA && !hasB) {
      confidence = 0;
      notes.push('AI panel returned no usable votes for either pass — cannot judge candidates.');
    } else {
      confidence = 1;

      // (a) Position-bias swap.
      if (positionBiasFlag) {
        confidence -= 0.4;
        notes.push(
          `Position-bias swap flipped the winner (original order: "${clean[winnerA]}", reversed order: "${clean[winnerB]}"). ` +
          'Reversed-order votes were discarded; treat this result as low-confidence.',
        );
      }
      if (hasA !== hasB) {
        confidence -= 0.2;
        notes.push('One of the two order passes (original / reversed) returned no usable votes; the ranking is based on the other pass alone.');
      }

      // (b) Score-clustering: candidates too close together to discriminate.
      const spread = finalScore.length > 1 ? Math.max(...finalScore) - Math.min(...finalScore) : 0;
      const clustered = spread < 0.15;
      if (clustered) {
        confidence -= 0.3;
        notes.push(
          `Panel is not discriminating between candidates: preference scores span only ${(spread * 100).toFixed(0)} of 100 points. ` +
          'Treat the ranking as low-confidence.',
        );
      }

      // (c) Jaccard rationale repetition: near-identical reasons signal judge collapse.
      const rep = repetitionScore(contributing.map((r) => r.reason));
      if (rep.duplicatePairs > 0 && rep.ratio >= 0.3) {
        confidence -= 0.25;
        notes.push(
          `Possible judge collapse: ${(rep.ratio * 100).toFixed(0)}% of persona reasons are near-duplicates ` +
          `(${rep.duplicatePairs} near-identical pairs).`,
        );
      }

      // Small panels are inherently noisier.
      if (panel.length < 3) confidence -= 0.1;
    }
    confidence = Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));

    const rankings: CandidateRanking[] = clean
      .map((c, i) => ({
        candidate: c,
        index: i,
        score: Math.round(finalScore[i] * 1000) / 1000,
        rationale: buildRationale(i, contributing),
      }))
      .sort((a, b) => b.score - a.score);

    const winnerIndex = finalScore.length > 0 ? argmaxIndex(finalScore) : 0;

    return { kind, format, rankings, winnerIndex, confidence, notes };
  }
}
