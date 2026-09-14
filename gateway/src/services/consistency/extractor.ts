import { jsonrepair } from 'jsonrepair';
import type { LedgerFact, FactType, FactSource, KnowledgeKind, KnowledgeSource } from './types.js';

/**
 * Parse JSON, falling back to a deterministic repair pass when the model emits
 * slightly-invalid JSON. LLMs intermittently return unterminated strings (output
 * truncated at the token cap), bad escapes, trailing commas, or unquoted keys —
 * each of which makes strict JSON.parse throw and the whole chapter get dropped.
 * `jsonrepair` is a pure, deterministic fixer (closes truncated strings/arrays/
 * objects, fixes escapes/commas), so we recover the facts the model did produce
 * instead of losing the chapter. Still throws if the text is unrecoverable.
 */
function parseJsonLenient(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return JSON.parse(jsonrepair(s));
  }
}

/**
 * Canonical form of a fact value. `valueNorm` is the EQUALITY KEY the contradiction
 * check compares (`check-engine.ts`: `p.valueNorm !== fact.valueNorm`), so two
 * renderings of the same value must land on the same string or the gate reports a
 * contradiction between two visibly identical strings (observed in production: the
 * same address flagged against itself because one chapter's extraction carried a
 * trailing period).
 *
 * Deliberately conservative — over-normalising creates the opposite, worse bug
 * (two genuinely different values collapsing into one, so a real contradiction goes
 * unreported). So this only folds differences that cannot change meaning:
 * case, Unicode form, typographic quotes/dashes, whitespace runs, zero-width
 * characters, trailing sentence punctuation, and delimiters wrapping the whole
 * value. It does NOT touch interior punctuation, digits, articles, or word forms.
 *
 * Also the third segment of a knowledge `factKey`, so an acquire and a use of the
 * same fact group together in check-engine.
 */
export function normalizeFactValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  let s = value
    .normalize('NFKC')                       // composed/decomposed + full-width forms converge
    .replace(/[​-‍⁠﻿]/g, '') // zero-width/invisible chars render identically
    .replace(/[‘’‚‛′]/g, "'")  // curly/quote-like apostrophes → '
    .replace(/[“”„‟″]/g, '"')  // curly double quotes → "
    .replace(/[‐-―−]/g, '-')  // hyphens/en/em dashes/minus → -
    .toLowerCase()
    .replace(/\s+/g, ' ')                    // \s covers NBSP and the other Unicode spaces
    .trim();
  // Trailing punctuation and enclosing wrappers, to a fixed point: an end-anchored
  // punctuation strip alone is defeated by a wrapper (`"the office."`), and a model
  // quoting its own value is at least as likely as one adding a period. Looping
  // also keeps the function idempotent.
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = stripEnclosingWrapper(s.replace(/[.,;:!?]+$/, '').trim());
    if (s === before) break;
  }
  return s;
}

const WRAPPER_PAIRS: [string, string][] = [['"', '"'], ["'", "'"], ['(', ')'], ['[', ']']];

/**
 * Drop one layer of wrapping delimiters, but ONLY when they enclose the whole
 * value and the interior contains neither delimiter — so `"the office"` folds to
 * `the office` while `"a" and "b"` and `maya's office` are left untouched. A
 * value that is another value wrapped in quotes is the same value, so this can't
 * collapse two genuinely different ones.
 */
function stripEnclosingWrapper(s: string): string {
  if (s.length < 2) return s;
  for (const [open, close] of WRAPPER_PAIRS) {
    if (s.startsWith(open) && s.endsWith(close)) {
      const inner = s.slice(1, -1);
      if (!inner.includes(open) && !inner.includes(close)) return inner.trim();
    }
  }
  return s;
}

/**
 * Upper bound for a scene index when the response carries no scene list to clamp
 * against. Story-time is laid out as `chapterNumber * 1000 + sceneIndex`
 * (continuity-check.ts), so anything past 999 escapes its own chapter's band and
 * collides with the next chapter's.
 */
const MAX_SCENE_INDEX = 999;

/**
 * Coerce an LLM-supplied scene index to a non-negative integer inside the
 * chapter's band. The model intermittently returns `"scenes": []` (or jsonrepair
 * drops the array), and the raw index was used unchecked on that path: a string
 * index made `chapterStoryBase + scene` a STRING (every `===` in the
 * impossibility rule then false, silently disabling the check for that fact),
 * and an out-of-range index put the fact in another chapter's band.
 */
function coerceSceneIndex(raw: unknown, sceneCount: number): number {
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, sceneCount > 0 ? sceneCount - 1 : MAX_SCENE_INDEX);
}

export interface ExtractedScene {
  storyTime: number;
  timeLabel: string | null;
  canonical: boolean;
}

export interface ExtractedKnowledge {
  knower: string; factKey: string;
  kind: KnowledgeKind; source: KnowledgeSource;
  storyTime: number; scene: number; canonical: boolean; evidence: string;
}

export interface ExtractResult {
  facts: Omit<LedgerFact, 'world' | 'bookSlug' | 'chapter' | 'storyElapsed'>[];
  scenes: ExtractedScene[];
  knowledge: ExtractedKnowledge[];
}

/**
 * Pure: strip ```code fences```, JSON.parse, coerce each fact to the typed shape,
 * compute storyTime = chapterStoryBase + (scene ?? 0).
 * Throws on unparseable JSON; the caller fail-softs.
 */
export function parseExtractorResponse(text: string, chapterStoryBase: number): ExtractResult {
  // Strip optional ```json ... ``` or ``` ... ``` fences.
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  // An empty response has nothing to parse or repair — give a clear reason
  // rather than the cryptic "Unexpected end of json string at position 0" that
  // jsonrepair throws on empty input (the model returned no content, e.g. a
  // safety-filter block on a provider that doesn't surface it as an error).
  if (!stripped) {
    throw new Error('Extractor model returned an empty response (no content to parse)');
  }

  const raw = parseJsonLenient(stripped);
  // A valid extractor response is a JSON OBJECT. jsonrepair will happily coerce
  // garbage prose into a bare JSON string, so reject anything that isn't an
  // object — that keeps a junk response a counted failure, not a silent 0-fact pass.
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Extractor response is not a JSON object');
  }
  const parsed = raw as {
    scenes?: Array<{ timeLabel?: string | null; canonical?: boolean }>;
    facts?: Array<{
      entity?: string;
      aliases?: string[];
      attribute?: string;
      type?: string;
      valueRaw?: string;
      valueNorm?: string;
      scene?: number;
      transition?: string | null;
      evidence?: string;
      source?: string;
    }>;
    knowledgeEvents?: Array<{
      knower?: string;
      factEntity?: string;
      factAttribute?: string;
      factValueNorm?: string;
      kind?: string;
      source?: string;
      scene?: number;
      evidence?: string;
    }>;
  };

  const rawScenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
  const scenes: ExtractedScene[] = rawScenes.map((s, i) => ({
    storyTime: chapterStoryBase + i,
    timeLabel: s.timeLabel ?? null,
    canonical: s.canonical === false ? false : true,
  }));

  const rawFacts = Array.isArray(parsed.facts) ? parsed.facts : [];
  const facts: Omit<LedgerFact, 'world' | 'bookSlug' | 'chapter' | 'storyElapsed'>[] = rawFacts.map((f) => {
    const entity = f.entity ?? '';
    const aliases: string[] = Array.isArray(f.aliases) && f.aliases.length > 0 ? f.aliases : [entity];
    const type: FactType = f.type === 'immutable' ? 'immutable' : 'stateful';
    const valueRaw = typeof f.valueRaw === 'string' ? f.valueRaw : '';
    // Normalise BOTH paths: an LLM-supplied valueNorm is a hint, not a canonical
    // key — taking it verbatim was half of the same-string-contradiction bug.
    const suppliedNorm = normalizeFactValue(f.valueNorm);
    const valueNorm = suppliedNorm.length > 0 ? suppliedNorm : normalizeFactValue(valueRaw);
    // Clamp the LLM-supplied scene index into range before deriving story-time /
    // time-label / canonical (mirrors audit.ts's storyElapsed clamp). An
    // out-of-range index would otherwise inflate storyTime and read undefined
    // scene metadata.
    const scene = coerceSceneIndex(f.scene, rawScenes.length);
    const source: FactSource = f.source === 'canon' ? 'canon' : 'manuscript';
    return {
      entity,
      aliases,
      attribute: f.attribute ?? '',
      type,
      valueRaw,
      valueNorm,
      storyTime: chapterStoryBase + scene,
      timeLabel: rawScenes[scene]?.timeLabel ?? null,
      transition: f.transition ?? null,
      scene,
      source,
      evidence: f.evidence ?? '',
      canonical: rawScenes[scene]?.canonical === false ? false : true,
    };
  });

  const rawKnow = Array.isArray(parsed.knowledgeEvents) ? parsed.knowledgeEvents : [];
  const allowedSources: KnowledgeSource[] = ['told', 'witnessed', 'deduced', 'reference', 'act_on'];
  const knowledge: ExtractedKnowledge[] = rawKnow.map((k) => {
    const knower = String(k.knower ?? '').trim();
    const factEntity = String(k.factEntity ?? '').trim();
    const factAttribute = String(k.factAttribute ?? '').trim();
    // Same canonical form as a fact's valueNorm above: the acquire and the use of
    // one fact only group together (check-engine keys on `knower + factKey`) if
    // both renderings land on the same string. Plain trim+lowercase left
    // "The Affair." and "the affair" as different keys, fabricating a
    // high-severity "learns it at no point in the story" violation.
    const factValueNorm = normalizeFactValue(String(k.factValueNorm ?? ''));
    // Clamp the LLM-supplied scene index into range (mirrors the facts path
    // above). An out-of-range index would otherwise inflate/deflate storyTime
    // and read undefined scene metadata (canonical silently defaulting true),
    // skewing the used-before-learned knowledge-timeline check.
    const scene = coerceSceneIndex(k.scene, rawScenes.length);
    const kind: KnowledgeKind = k.kind === 'acquire' ? 'acquire' : 'use';
    const source: KnowledgeSource = allowedSources.includes(k.source as KnowledgeSource)
      ? (k.source as KnowledgeSource)
      : (kind === 'acquire' ? 'told' : 'reference');
    return {
      knower,
      factKey: `${factEntity}\0${factAttribute}\0${factValueNorm}`,
      kind,
      source,
      storyTime: chapterStoryBase + scene,
      scene,
      canonical: rawScenes[scene]?.canonical === false ? false : true,
      evidence: String(k.evidence ?? ''),
    };
  }).filter((e) => e.knower !== '' && e.factKey.replace(/\0/g, '') !== '');

  return { facts, scenes, knowledge };
}

const SYSTEM_PROMPT = `You are an expert literary continuity extractor. Your sole task is to read a chapter of prose and return a STRICT JSON object — no prose, no markdown, no explanation — with exactly this shape:

{
  "scenes": [
    { "timeLabel": string | null, "canonical": boolean }
  ],
  "facts": [
    {
      "entity": string,
      "aliases": string[],
      "attribute": string,
      "type": "immutable" | "stateful",
      "valueRaw": string,
      "valueNorm": string,
      "scene": number,
      "transition": string | null,
      "evidence": string
    }
  ],
  "knowledgeEvents": [
    {
      "knower": string,
      "factEntity": string,
      "factAttribute": string,
      "factValueNorm": string,
      "kind": "acquire" | "use",
      "source": "told" | "witnessed" | "deduced" | "reference" | "act_on",
      "scene": number,
      "evidence": string
    }
  ]
}

Definitions:

scenes
  An ordered list of distinct time-points (scene breaks, chapter transitions, new-day markers) found in the chapter. Each entry has a "timeLabel": the author's own phrasing (e.g. "that evening", "next morning", "three days later") or null if the text gives no explicit time label. The first scene is index 0.
  "canonical": false when the scene is a dream, vision, hallucination, flashback/analepsis, or a hypothetical/counterfactual ("if he had…", "she imagined…", "in the dream"). true for normal narrative present. Default true when unsure.

facts
  Every observable, checkable claim about the story world. Capture all of:
  - Physical attributes of characters (eye color, hair, scars, height, species, age)
  - Clothing and equipment state (what a character is wearing or carrying)
  - Location (where a character or object is)
  - Injury and health state (wounds, illness, recovery)
  - Weather and environment (time of day, season, weather conditions)
  - Emotional or relationship state when it has a durable, checkable consequence
  - World-rule claims (magic laws, technology constraints, geography facts, institutional rules)

For each fact:
  entity      The canonical name for the person, place, or thing this fact describes. Use the most complete form (e.g. "John Marsh", not "John"). If the text uses multiple names/pronouns for the same entity, pick the canonical one.
  aliases     All names, pronouns, and nicknames the text uses for this entity in this chapter (include entity itself).
  attribute   A snake_case label for the property being described (e.g. eye_color, clothing_state, current_location, injury_left_arm, weather_condition, magic_rule_fire).
  type        "immutable" for facts that cannot change within the story world (eye color, birth species, scars from long-healed injuries). "stateful" for facts that can legitimately change (clothing, current location, injury healing, weather).
  valueRaw    The author's exact phrasing for the value (quoted directly or very close paraphrase).
  valueNorm   A normalized, canonical form: lowercase, resolve synonyms (emerald → green, azure → blue, crimson → red), strip filler words. Keep it short (1-4 words).
  scene       The 0-based index into "scenes" that this fact was established or last updated in.
  transition  If this fact is a stateful change from a prior value, the mechanism of change (e.g. "showered", "changed clothes", "healed over weeks"). Null for new facts or immutables.
  evidence    A short verbatim or near-verbatim quote (under 80 chars) from the text that establishes this fact.

knowledgeEvents
  Who knows what, and when. Emit an entry when a character LEARNS a fact (kind "acquire": is told, witnesses, overhears, or deduces it) or EXPLICITLY USES it (kind "use": states it outright, or acts on it). Only emit "use" for an explicit reference or action — never for a guess, a suspicion, or for narration the character is not party to.
  knower         The canonical character name who knows or uses the fact.
  factEntity, factAttribute, factValueNorm   Identify the fact this knowledge is about, using the SAME entity name and the same snake_case attribute + normalized value you would use in "facts" above.
  kind           "acquire" when the character gains the knowledge; "use" when they reference or act on it.
  source         For acquire: "told" | "witnessed" | "deduced". For use: "reference" (states it) | "act_on" (acts on it).
  scene          The 0-based index into "scenes" where this happens.
  evidence       A short verbatim quote (under 80 chars) from the text.

Rules:
  - One fact entry per (entity, attribute, scene) triple. If an attribute changes mid-scene, emit the final value and set transition.
  - Resolve coreferences: if "she" clearly refers to "Elena Voss", use "Elena Voss" as entity.
  - Use the known-entity digest supplied in the user message to map aliases to canonical names.
  - Do NOT invent facts not supported by the text.
  - Return valid JSON only. Do not wrap in markdown fences.`;

export async function extractChapterFacts(
  deps: {
    ai: {
      complete(req: any): Promise<{ text: string }>;
      select(t: string, preferredId?: string): { id: string };
    };
  },
  chapterText: string,
  knownEntities: { entity: string; aliases: string[]; current: Record<string, string> }[],
  chapterStoryBase: number,
  override?: { provider?: string; model?: string },
): Promise<ExtractResult> {
  const digestLines = knownEntities.map((e) => {
    const attrs = Object.entries(e.current)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    const aliasStr = e.aliases.length > 0 ? ` (also: ${e.aliases.join(', ')})` : '';
    return `- ${e.entity}${aliasStr}: ${attrs || 'no prior facts'}`;
  });

  const digest =
    knownEntities.length > 0
      ? `Known entities (canonical name → current attribute values):\n${digestLines.join('\n')}`
      : 'No prior entity facts established yet.';

  const content = `${digest}\n\n---\n\nChapter text:\n\n${chapterText}`;

  const provider = deps.ai.select('consistency', override?.provider);
  // Only honor the pinned model when the requested provider was actually
  // selected. If it was unavailable, selectProvider falls back to a different
  // provider and the pinned model id would mismatch (e.g. a Gemini model name
  // sent to Ollama → every extraction errors and the audit yields a false
  // all-clear). Fall back to that provider's default model instead.
  const model = override?.provider && provider.id === override.provider ? override?.model : undefined;
  const res = await deps.ai.complete({
    provider: provider.id,
    model,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    // Generous output cap: a dense chapter can emit many facts + knowledge
    // events as JSON; at 8000 the output was being truncated mid-string on busy
    // chapters, which broke JSON.parse and dropped the chapter (see parseJsonLenient).
    maxTokens: 16000,
    temperature: 0.1,
  });

  return parseExtractorResponse(res.text, chapterStoryBase);
}
