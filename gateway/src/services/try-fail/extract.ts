/**
 * Extraction (I/O boundary) for the Try-Fail & Escalation Auditor (TODO #15).
 *
 * One structured-JSON LLM call over the (optionally condensed) manuscript yields
 * an AuditExtraction; the deterministic core (score.ts) does the rest. The parse
 * is tolerant (strip code fences, jsonrepair fallback — mirrors the consistency
 * extractor) and clamping/coercing, and NEVER throws: garbage in → empty shape.
 */
import { jsonrepair } from 'jsonrepair';
import type {
  AttemptOutcome,
  AttemptRecord,
  AuditExtraction,
  Cost,
  CrucibleSignal,
} from './types.js';

const EMPTY: AuditExtraction = { protagonists: [], attempts: [], crucibleSignals: [] };

const OUTCOMES: AttemptOutcome[] = ['success', 'partial', 'failure', 'none'];
const COSTS: Cost[] = ['none', 'low', 'medium', 'high'];
const CRUCIBLE_KINDS: CrucibleSignal['kind'][] = ['setting', 'relationship', 'duty', 'other'];
const STRENGTHS: CrucibleSignal['strength'][] = ['weak', 'moderate', 'strong'];

/** JSON.parse with a deterministic jsonrepair fallback (truncated strings, trailing commas). */
function parseJsonLenient(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return JSON.parse(jsonrepair(s));
  }
}

function toInt(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

/**
 * Tolerant parse of the model's AuditExtraction JSON. Strips ```code fences```,
 * parses leniently, clamps personalStakes to 0–5, coerces peopleAffected ≥0,
 * defaults invalid outcome/cost, and drops attempts with no protagonist.
 * Never throws → returns the empty shape on any unrecoverable input.
 */
export function parseAuditExtraction(raw: string): AuditExtraction {
  const stripped = (raw ?? '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  if (!stripped) return { ...EMPTY };

  // The model sometimes wraps the JSON in prose or an unbalanced fence
  // ("Here is the analysis: { … } Hope that helps!"). When the payload isn't
  // already a bare object, slice to the outermost {…} so jsonrepair doesn't
  // "succeed" on the prose blob and silently yield an empty extraction.
  let candidate = stripped;
  if (!candidate.startsWith('{')) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return { ...EMPTY };
    candidate = candidate.slice(start, end + 1);
  }

  let parsed: unknown;
  try {
    parsed = parseJsonLenient(candidate);
  } catch {
    return { ...EMPTY };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ...EMPTY };
  }

  const obj = parsed as {
    protagonists?: unknown;
    attempts?: unknown;
    crucibleSignals?: unknown;
  };

  const protagonists: string[] = Array.isArray(obj.protagonists)
    ? obj.protagonists.map((p) => String(p ?? '').trim()).filter((p) => p !== '')
    : [];

  const rawAttempts = Array.isArray(obj.attempts) ? obj.attempts : [];
  const attempts: AttemptRecord[] = [];
  for (const a of rawAttempts) {
    if (typeof a !== 'object' || a === null) continue;
    const r = a as Record<string, unknown>;
    const protagonist = String(r.protagonist ?? '').trim();
    if (protagonist === '') continue;
    const outcome: AttemptOutcome = OUTCOMES.includes(r.outcome as AttemptOutcome)
      ? (r.outcome as AttemptOutcome)
      : 'none';
    const cost: Cost = COSTS.includes(r.cost as Cost) ? (r.cost as Cost) : 'none';
    const personalStakes = Math.min(5, Math.max(0, toInt(r.personalStakes, 0)));
    const peopleAffected = Math.max(0, toInt(r.peopleAffected, 0));
    attempts.push({
      protagonist,
      chapter: toInt(r.chapter, 0),
      goal: String(r.goal ?? ''),
      conflict: String(r.conflict ?? ''),
      outcome,
      cost,
      personalStakes,
      peopleAffected,
    });
  }

  const rawSignals = Array.isArray(obj.crucibleSignals) ? obj.crucibleSignals : [];
  const crucibleSignals: CrucibleSignal[] = [];
  for (const s of rawSignals) {
    if (typeof s !== 'object' || s === null) continue;
    const r = s as Record<string, unknown>;
    const kind = CRUCIBLE_KINDS.includes(r.kind as CrucibleSignal['kind'])
      ? (r.kind as CrucibleSignal['kind'])
      : 'other';
    const strength = STRENGTHS.includes(r.strength as CrucibleSignal['strength'])
      ? (r.strength as CrucibleSignal['strength'])
      : 'weak';
    crucibleSignals.push({
      kind,
      description: String(r.description ?? ''),
      strength,
      chapter: toInt(r.chapter, 0),
    });
  }

  return { protagonists, attempts, crucibleSignals };
}

/**
 * Condense the manuscript when its joined text exceeds `charBudget`: keep each
 * chapter's head+tail so the model still sees every chapter's setup and payoff
 * (where attempts begin and resolve) without blowing the context window.
 * Returns the chapters unchanged with `condensed: false` when under budget.
 */
export function condenseChapters(
  chapters: { n: number; text: string }[],
  charBudget = 120000,
): { chapters: { n: number; text: string }[]; condensed: boolean } {
  const total = chapters.reduce((sum, c) => sum + c.text.length, 0);
  if (total <= charBudget || chapters.length === 0) {
    return { chapters, condensed: false };
  }
  // Per-chapter budget split evenly, reserving the elision-marker overhead so the
  // condensed total stays within budget even for a book with very many chapters
  // (a fixed floor like 1000 would let N*1000 blow past the budget).
  const MARKER = '\n\n[… middle of chapter condensed …]\n\n';
  const perChapter = Math.max(100, Math.floor(charBudget / chapters.length) - MARKER.length);
  const condensed = chapters.map((c) => {
    if (c.text.length <= perChapter) return c;
    const half = Math.floor(perChapter / 2);
    const head = c.text.slice(0, half);
    const tail = c.text.slice(c.text.length - half);
    return { n: c.n, text: `${head}${MARKER}${tail}` };
  });
  return { chapters: condensed, condensed: true };
}

const SYSTEM_PROMPT = `You are an expert story-structure analyst. Read an entire novel manuscript and return a STRICT JSON object — no prose, no markdown, no explanation — describing its try-fail cycles, escalation, and crucible. Shape exactly:

{
  "protagonists": string[],
  "attempts": [
    {
      "protagonist": string,
      "chapter": number,
      "goal": string,
      "conflict": string,
      "outcome": "success" | "partial" | "failure" | "none",
      "cost": "none" | "low" | "medium" | "high",
      "personalStakes": number,
      "peopleAffected": number
    }
  ],
  "crucibleSignals": [
    {
      "kind": "setting" | "relationship" | "duty" | "other",
      "description": string,
      "strength": "weak" | "moderate" | "strong",
      "chapter": number
    }
  ]
}

Definitions:

protagonists
  The roster of point-of-view / driving characters whose goals power the plot. Use each character's canonical full name.

attempts (try-fail cycles)
  A "try-fail cycle" is a discrete unit where a protagonist actively PURSUES a goal against a CONFLICT and we see an OUTCOME. Emit one entry per attempt, in chapter order. Do not invent attempts; only record where the text shows a protagonist trying something against opposition.
  protagonist     The canonical name of the character making the attempt.
  chapter         The 1-based chapter number where the attempt resolves.
  goal            One short phrase: what the character is trying to achieve.
  conflict        One short phrase: the opposing force / obstacle.
  outcome         "success" (the goal is achieved), "partial" (achieved at a heavy compromise or with a new problem created), "failure" (the goal is not achieved / a setback), or "none" (the attempt is interrupted/unresolved).
  cost            What the win/attempt costs the character. "none" = costless; "low" = minor; "medium" = a real sacrifice; "high" = a severe loss (relationship, limb, ally, principle).
  personalStakes  Integer 0–5 — how much this conflict matters to the character emotionally/personally. 0 = trivial, 5 = life-defining / existential. This is the DEEPEN axis; it should rise across a well-built arc.
  peopleAffected  Integer ≥ 0 — how many people are affected by the outcome (a rough count or scale: 1 = just the character, tens, hundreds, thousands…). This is the BROADEN axis; it should rise across a well-built arc.

crucibleSignals (the crucible / binding force)
  A "crucible" is a force that keeps the characters locked in the conflict so they cannot simply walk away. Emit a signal for each binding force you find.
  kind            "setting" (a place they can't leave), "relationship" (a bond that holds them), "duty" (an obligation/oath/role), or "other".
  description     One short phrase naming the binding force.
  strength        "weak", "moderate", or "strong" — how powerfully it prevents the characters from walking away.
  chapter         The 1-based chapter where the binding force is established/strongest.

Rules:
  - Record only what the text supports. Do NOT invent attempts or crucible signals.
  - personalStakes is an integer 0–5; peopleAffected is an integer ≥ 0.
  - Return valid JSON only. Do not wrap in markdown fences.`;

/**
 * Build the single-call audit prompt over the (already condensed if needed)
 * chapters. The user message labels each chapter so the model can attribute
 * attempts to the right chapter number.
 */
export function buildAuditPrompt(chapters: { n: number; text: string }[]): { system: string; user: string } {
  const body = chapters
    .map((c) => `## Chapter ${c.n}\n\n${c.text}`)
    .join('\n\n');
  const user = `Analyze the following manuscript and return the strict JSON AuditExtraction described in your instructions.\n\n${body}`;
  return { system: SYSTEM_PROMPT, user };
}
