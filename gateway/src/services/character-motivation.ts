/**
 * BookClaw Character Motivation Check
 *
 * Scoped port of the AuthorAgent fork's character-agent.ts (design spec
 * docs/superpowers/specs/2026-07-11-authoragent-tier4-features-design.md,
 * item #12). The fork bundles three checks (off-voice, anachronistic-
 * knowledge, off-motivation) into one persona agent; only motivation is new
 * to this tree — off-voice duplicates character-voices.ts's drift detector
 * and anachronistic-knowledge duplicates continuity-check.ts's (strictly
 * stronger) fact-level knowledge evaluation. Both are dropped here.
 *
 * Given a chapter, extract each eligible character's spoken lines and ask
 * an AI "motivation coach" — briefed with that character's established
 * attributes and arc (change-log) — to flag lines that contradict who the
 * character is or what they want. Conservative by design: only genuine
 * motivation breaks are flagged, not new-but-plausible development.
 *
 * ─── Reuses (does not rebuild) ─────────────────────────────────────────────
 *   • context-engine.ts — EntityEntry (attributes + arc via change-log),
 *     ChapterSummary, AICompleteFn/AISelectProviderFn.
 *   • router.ts TASK_TIERS — 'style_analysis' (mid) tier per character call.
 *   • jsonrepair — the repo's standard tolerant JSON parser (also used by
 *     ContextEngine) for recovering slightly-malformed AI JSON.
 *
 * Dialogue extraction is an inline, trimmed copy adapted from
 * character-voices.ts's extractDialogue (paragraph split → quote detect →
 * speaker tag / turn-taking) — kept independent per the design spec so this
 * service does not depend on the not-yet-built shared dialogue-parser (#16).
 *
 * ─── Cost discipline ────────────────────────────────────────────────────
 * ONE 'style_analysis'-tier AI call PER ELIGIBLE CHARACTER, capped at the
 * top MAX_CHARACTERS_PER_RUN speaking characters. Characters with fewer than
 * MIN_LINES_FOR_CRITIQUE lines are skipped (no call). Brief assembly is
 * pure — no AI, no I/O.
 */

import type {
  ChapterSummary,
  EntityEntry,
  AICompleteFn,
  AISelectProviderFn,
} from './context-engine.js';
import { jsonrepair } from 'jsonrepair';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

/**
 * A compact profile assembled for one character — attributes + arc only
 * (no knowledge horizon, no voice fingerprint; those belong to other
 * detectors). Pure assembly — no AI, no I/O.
 */
export interface CharacterMotivationBrief {
  /** Canonical character name. */
  name: string;
  /** Names/titles the character is also known by. */
  aliases: string[];
  /** One-line description from the entity DB. */
  description: string;
  /** Established key/value facts (from EntityEntry.attributes), e.g. wants/goals. */
  attributes: Record<string, string>;
  /** Arc / motivation signals: the entity change-log rendered as a timeline of
   *  how this character's facts evolved (chapterId → what changed). */
  arc: Array<{ chapterId: string; description: string }>;
}

/** A single motivation-contradicting line flagged by the coach. */
export interface CharacterMotivationFlag {
  /** The quoted line as it appears in the chapter. */
  line: string;
  /** Why this line contradicts the character's established motivation. */
  reason: string;
  /** A rewrite that fixes it while preserving the line's story function. */
  suggestion: string;
}

/** Per-character critique block within the report. */
export interface CharacterMotivationCritique {
  character: string;
  /** How many lines of this character's dialogue were reviewed. */
  linesReviewed: number;
  flags: CharacterMotivationFlag[];
}

/** The aggregated report from one critiqueMotivation() run. */
export interface CharacterMotivationReport {
  projectId: string;
  chapterId?: string;
  generatedAt: string;
  /** Canonical names of the characters actually reviewed (an AI call was made). */
  charactersReviewed: string[];
  /** Total flags across all characters. */
  totalFlags: number;
  byCharacter: CharacterMotivationCritique[];
}

export interface CritiqueMotivationInput {
  projectId: string;
  chapterText: string;
  chapterId?: string;
  /** Optional filter — critique only these characters (by canonical name or
   *  alias). Unknown names are ignored; omitting runs the top speakers. */
  characters?: string[];
}

// ═══════════════════════════════════════════════════════════
// Tuning
// ═══════════════════════════════════════════════════════════

/** Minimum spoken lines a character needs before we spend a call on them. */
const MIN_LINES_FOR_CRITIQUE = 3;
/** Hard cap on AI calls per run — critique the top-N speaking characters only. */
const MAX_CHARACTERS_PER_RUN = 5;
/**
 * Same speech-verb list character-voices.ts's extractDialogue uses, so line
 * attribution here matches what the voice-fingerprint pipeline sees.
 */
const SPEECH_VERBS =
  'said|asked|whispered|shouted|murmured|replied|added|continued|growled|hissed|breathed|spat|snapped|laughed|cried|exclaimed|gasped|muttered|sighed|stammered';

// ═══════════════════════════════════════════════════════════
// AI prompt
// ═══════════════════════════════════════════════════════════

const MOTIVATION_COACH_SYSTEM_PROMPT = `You are a MOTIVATION COACH for ONE specific character in a novel. You know this character's established facts and arc. You are given that character's BRIEF, followed by the lines they speak in one chapter (numbered).

Your job: review ONLY this character's lines and flag any that CONTRADICT their established motivation — their attributes (including wants/goals) or their arc (says or wants something at odds with who they are or what they want).

Rules:
- Judge ONLY the given character's lines against the brief. Ignore voice/register/rhythm and knowledge — motivation only.
- Be conservative. A line that is merely fine, or a NEW but plausible development, is NOT a flag. Only flag genuine motivation breaks.
- For every flag, quote the offending line, explain WHY (referencing the brief), and give a rewrite that fixes it while preserving the line's story function.
- If nothing contradicts their motivation, return an empty list.

Return ONLY valid JSON. No markdown code fences. No commentary. Close every brace and bracket.
Shape:
{"flags":[{"line":"the exact line","reason":"...","suggestion":"a rewrite consistent with their motivation"}]}
If none: {"flags":[]}`;

// ═══════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════

export class CharacterMotivationService {
  // ── Brief assembly (pure — no AI) ────────────────────────

  /**
   * Assemble a compact motivation brief for one entity from its attributes
   * and arc (change-log). Pure — no AI, no I/O.
   */
  buildCharacterMotivationBrief(entity: EntityEntry): CharacterMotivationBrief {
    return {
      name: entity.name,
      aliases: entity.aliases ?? [],
      description: entity.description ?? '',
      attributes: entity.attributes ?? {},
      arc: (entity.changes ?? []).map((c) => ({ chapterId: c.chapterId, description: c.description })),
    };
  }

  // ── Critique (AI — one call per character, capped) ───────

  /**
   * Extract each major character's dialogue from the chapter and run a
   * per-character 'style_analysis'-tier motivation critique. Returns a
   * structured report.
   *
   * Never throws on malformed AI output — a malformed/empty response for a
   * character yields that character with an empty flags list (they were
   * still "reviewed"). A genuine provider transport error DOES propagate.
   */
  async critiqueMotivation(
    input: CritiqueMotivationInput,
    aiComplete: AICompleteFn,
    aiSelectProvider: AISelectProviderFn,
    // Entities + summaries are passed in (route pulls them from ContextEngine's
    // cached getters) so this service stays free of persistence concerns.
    entities: EntityEntry[],
    // Accepted for signature parity with the entities/summaries pairing used
    // elsewhere (ContextEngine.getEntities/getSummaries). The motivation
    // brief itself only needs `entities` (attributes + change-log) — no
    // knowledge-horizon check here, so summaries are unused.
    summaries: ChapterSummary[],
  ): Promise<CharacterMotivationReport> {
    void summaries;
    const characters = (entities ?? []).filter((e) => e.type === 'character');

    // ── (a) Build the canonical name lookup + extract dialogue by character ──
    const canonicalNames: string[] = [];
    const aliasMap: Record<string, string[]> = {};
    for (const c of characters) {
      canonicalNames.push(c.name);
      if (c.aliases?.length) aliasMap[c.name] = c.aliases;
    }
    const linesByCharacter = this.extractLinesByCharacter(input.chapterText, canonicalNames, aliasMap);

    // ── (b) Decide which characters to critique ──
    // Optional explicit filter (canonicalized), else the top speakers by line
    // count. Always: skip characters below the min-lines threshold, cap at N.
    let candidates = characters;
    if (Array.isArray(input.characters) && input.characters.length > 0) {
      const wanted = new Set(input.characters.map((n) => String(n).toLowerCase().trim()));
      candidates = characters.filter((c) => {
        const keys = this.nameKeysFor(c);
        for (const k of keys) if (wanted.has(k)) return true;
        return false;
      });
    }

    const eligible = candidates
      .map((c) => ({ entity: c, lines: linesByCharacter.get(c.name) ?? [] }))
      .filter((x) => x.lines.length >= MIN_LINES_FOR_CRITIQUE)
      .sort((a, b) => b.lines.length - a.lines.length)
      .slice(0, MAX_CHARACTERS_PER_RUN);

    // ── (c) One critique call per eligible character ──
    const byCharacter: CharacterMotivationCritique[] = [];
    for (const { entity, lines } of eligible) {
      const brief = this.buildCharacterMotivationBrief(entity);
      const flags = await this.critiqueOneCharacter(brief, lines, aiComplete, aiSelectProvider);
      byCharacter.push({
        character: entity.name,
        linesReviewed: lines.length,
        flags,
      });
    }

    const totalFlags = byCharacter.reduce((sum, c) => sum + c.flags.length, 0);
    return {
      projectId: input.projectId,
      chapterId: input.chapterId,
      generatedAt: new Date().toISOString(),
      charactersReviewed: byCharacter.map((c) => c.character),
      totalFlags,
      byCharacter,
    };
  }

  // ── One-character critique call ──────────────────────────

  private async critiqueOneCharacter(
    brief: CharacterMotivationBrief,
    lines: string[],
    aiComplete: AICompleteFn,
    aiSelectProvider: AISelectProviderFn,
  ): Promise<CharacterMotivationFlag[]> {
    // Honor the cost tier: per-character critique is a style/analysis
    // judgement → the mid 'style_analysis' tier (never premium).
    const provider = aiSelectProvider('style_analysis');

    const numberedLines = lines.map((l, i) => `${i + 1}. "${l}"`).join('\n');
    const userContent = [
      `=== CHARACTER BRIEF: ${brief.name} ===`,
      this.renderBrief(brief),
      '',
      `=== ${brief.name}'S LINES IN THIS CHAPTER ===`,
      numberedLines || '(no lines)',
    ].join('\n');

    const response = await aiComplete({
      provider: provider.id,
      system: MOTIVATION_COACH_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      // A single character's flag list is short. 3072 leaves room for a
      // handful of quoted-line + rewrite findings without bloating cost.
      maxTokens: 3072,
      temperature: 0.2,
    });

    return this.parseFlags(response?.text ?? '');
  }

  // ── Dialogue extraction (inline, trimmed copy of character-voices.ts) ────

  /**
   * Extract spoken lines from the chapter and bucket them by canonical
   * character. Adapted from CharacterVoicesService.extractDialogue
   * (explicit / reverse tag → known-name validation → turn-taking fallback),
   * trimmed to just the speaker→lines bucketing this service needs (no
   * attribution-confidence tracking). Kept independent of dialogue-parser.ts
   * (#16, not yet built) per the design spec.
   */
  private extractLinesByCharacter(
    chapterText: string,
    characterNames: string[],
    aliases: Record<string, string[]>,
  ): Map<string, string[]> {
    const out = new Map<string, string[]>();
    const charNameLower = new Map<string, string>();
    for (const n of characterNames) charNameLower.set(n.toLowerCase(), n);
    for (const [canon, aliasList] of Object.entries(aliases)) {
      for (const a of aliasList) charNameLower.set(a.toLowerCase(), canon);
    }

    const paragraphs = (chapterText || '').split(/\n\s*\n+/).filter((p) => p.trim());
    let lastSpeaker: string | null = null;

    const explicitTagRe = new RegExp(
      `["”]\\s*[,.?!]?\\s*([A-Z][a-z]{2,}(?:\\s+[A-Z][a-z]+)?)\\s+(?:${SPEECH_VERBS})\\b`,
      'i',
    );
    const reverseTagRe = new RegExp(
      `["”]\\s*[,.?!]?\\s*(?:${SPEECH_VERBS})\\s+([A-Z][a-z]{2,}(?:\\s+[A-Z][a-z]+)?)`,
      'i',
    );

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!/^["“]/.test(trimmed)) continue; // pure narration — skip

      const spokenMatches = trimmed.match(/["“]([^"“”]+)["”]/g) || [];
      let spoken = spokenMatches
        .map((m) => m.replace(/^["“]/, '').replace(/["”]$/, '').trim())
        .filter((s) => s.length > 0)
        .join(' ');
      if (!spoken) {
        // No full quote pair (mismatched/unclosed quote). Fall back to the
        // text after the leading quote.
        spoken = trimmed.replace(/^["“]/, '').replace(/["”]$/, '').trim();
      }
      if (!spoken) continue;

      let speakerName: string | null = null;
      const explicit = trimmed.match(explicitTagRe);
      if (explicit?.[1]) {
        speakerName = explicit[1].trim();
      } else {
        const reverse = trimmed.match(reverseTagRe);
        if (reverse?.[1]) speakerName = reverse[1].trim();
      }

      if (speakerName) {
        const canonical = charNameLower.get(speakerName.toLowerCase());
        if (canonical) {
          speakerName = canonical;
          lastSpeaker = canonical;
        } else {
          // Unknown tagged name — not one of our tracked characters; skip
          // (don't pin it on lastSpeaker, since a real different speaker
          // just spoke).
          speakerName = null;
        }
      } else if (lastSpeaker) {
        // Bare dialogue — turn-taking heuristic.
        speakerName = lastSpeaker;
      }

      if (speakerName) {
        if (!out.has(speakerName)) out.set(speakerName, []);
        out.get(speakerName)!.push(spoken);
      }
    }
    return out;
  }

  /** All lowercase keys (canonical + aliases) that identify an entity. */
  private nameKeysFor(entity: EntityEntry): Set<string> {
    const keys = new Set<string>();
    if (entity.name) keys.add(entity.name.toLowerCase().trim());
    for (const a of entity.aliases ?? []) keys.add(String(a).toLowerCase().trim());
    return keys;
  }

  // ── Rendering helpers ────────────────────────────────────

  /** Compact, model-readable rendering of a brief. */
  private renderBrief(brief: CharacterMotivationBrief): string {
    const lines: string[] = [];
    if (brief.description) lines.push(`Description: ${brief.description}`);
    if (brief.aliases.length) lines.push(`Also known as: ${brief.aliases.join(', ')}`);

    const attrs = Object.entries(brief.attributes);
    if (attrs.length) {
      lines.push(`Established facts: ${attrs.map(([k, v]) => `${k}=${v}`).join('; ')}`);
    }

    if (brief.arc.length) {
      lines.push('Arc / how their facts changed over the story:');
      for (const a of brief.arc) lines.push(`  • [${a.chapterId}] ${a.description}`);
    }

    return lines.join('\n') || '(no established facts yet)';
  }

  // ── AI output parsing (never throws) ─────────────────────

  /**
   * Parse the coach's JSON and coerce each entry into a well-typed
   * CharacterMotivationFlag. A flag with no line AND no reason is dropped.
   * NEVER throws — malformed/empty output yields [].
   */
  private parseFlags(text: string): CharacterMotivationFlag[] {
    const parsed = this.safeParseJson(text);
    if (!parsed) return [];

    const rawList = Array.isArray(parsed?.flags)
      ? parsed.flags
      : Array.isArray(parsed)
        ? parsed
        : [];

    const out: CharacterMotivationFlag[] = [];
    for (const item of rawList) {
      const flag = this.normalizeFlag(item);
      if (flag) out.push(flag);
    }
    return out;
  }

  private normalizeFlag(item: any): CharacterMotivationFlag | null {
    if (!item || typeof item !== 'object') return null;
    const line = typeof item.line === 'string' ? item.line.trim() : '';
    const reason = typeof item.reason === 'string' ? item.reason.trim() : '';
    const suggestion = typeof item.suggestion === 'string' ? item.suggestion.trim() : '';

    // A usable flag needs the offending line AND some reason. Without the line
    // the author can't locate it; without a reason it isn't defensible.
    if (!line || !reason) return null;

    return { line, reason, suggestion };
  }

  /**
   * Tolerant JSON parse: strip code fences, bound the candidate to the outer
   * object/array, then JSON.parse with a jsonrepair fallback (the repo's
   * standard tolerant parser — also used by ContextEngine) for trailing
   * commas / minor truncation. Returns null on total failure — never throws.
   */
  private safeParseJson(text: string): any | null {
    if (!text || !text.trim()) return null;

    const cleaned = text
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    const startObj = cleaned.indexOf('{');
    const startArr = cleaned.indexOf('[');
    const start = startObj < 0 ? startArr : startArr < 0 ? startObj : Math.min(startObj, startArr);
    if (start < 0) return null;

    const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
    if (end <= start) return null;

    const candidate = cleaned.substring(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      /* fall through */
    }
    try {
      return JSON.parse(jsonrepair(candidate));
    } catch {
      return null;
    }
  }
}
