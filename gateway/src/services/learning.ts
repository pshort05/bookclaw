/**
 * BookClaw Learning Service — the LEARN-FROM-EXPERIENCE loop.
 *
 * Ported from the AuthorAgent fork's `learning.ts` (revision-orchestrator /
 * contradiction-detector / character-agent based). BookClaw has no analogues
 * for those three producers, so section (a) below (pattern detection) is
 * rewritten from scratch against OUR deterministic quality tools:
 *   - craft-critic.ts (CraftReport/CraftFlag)      → foldCraft
 *   - dialogue-auditor.ts (DialogueReport/DialogueFlag) → foldDialogue
 *   - consistency/continuity-check.ts (ContinuityFlag[]) → foldContinuity
 * Sections (b) AI-phrasing and (c) dedup-aware store writes are ported
 * near-verbatim — they don't depend on the producer shape.
 *
 * How the loop closes:
 *   1. Aggregate findings across the given reports with cheap CODE (group by
 *      category / speaker+issue / kind, count).
 *   2. Distil the top recurring patterns into concise, actionable lesson
 *      text — ONE optional free-tier ('general') AI call to phrase them
 *      well, with a deterministic fallback so it works with no API keys.
 *   3. Write each lesson to the LessonStore (dedup-aware: a lesson already
 *      known gets its confidence bumped, not re-added).
 *   4. LessonStore.buildContext() already injects high-confidence lessons
 *      into the writing system prompt. The moment a lesson lands in the
 *      store, the next write/revision sees it — the loop closes
 *      automatically.
 *
 * Cost discipline: aggregation is pure CODE (no AI). AT MOST ONE free-tier
 * AI call phrases the top-N patterns. If no aiComplete is wired (or it
 * fails/returns junk), deterministic lesson text is emitted straight from
 * the counts. Never throws.
 */

import type { CraftReport, CraftFlag } from './craft-critic.js';
import type { DialogueReport, DialogueFlag } from './dialogue-auditor.js';
import type { ContinuityFlag } from './consistency/continuity-check.js';
import type { LessonStore, Lesson } from './lessons.js';
import type { AICompleteFn, AISelectProviderFn } from './context-engine.js';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export type LearnReportType = 'craft' | 'dialogue' | 'continuity';

/** One report handed to the learner, tagged with which tool produced it. */
export interface LearnReportInput {
  type: LearnReportType;
  report: CraftReport | DialogueReport | ContinuityFlag[];
}

export interface LearnFromReportsInput {
  projectId?: string;
  reports: LearnReportInput[];
}

/** A recurring pattern detected by CODE aggregation across the reports. */
export interface DetectedPattern {
  /** Stable key identifying this pattern (e.g. 'craft:adverbs'). */
  key: string;
  /** Which tool family this pattern came from. */
  kind: LearnReportType;
  /** The grouping axis value (a craft category, a continuity kind, or a
   *  speaker + issue), for display/deterministic phrasing. */
  label: string;
  /** How many findings across all reports rolled up into this pattern. */
  count: number;
  /** Worst severity seen for this pattern ('error' > 'warning' > 'info'). */
  severity: 'error' | 'warning' | 'info';
  /** The LessonStore category this pattern maps to (writing_quality, etc). */
  lessonCategory: string;
  /** A short human-readable sample description (first finding), for context. */
  sample?: string;
}

/** A lesson that was written (or bumped) as a result of learning. */
export interface LearnedLesson {
  text: string;
  /** The provenance tag we intended (e.g. 'learned:craft'). The underlying
   *  store coerces `source` to its own vocabulary; this preserves intent. */
  source: string;
  confidence: number;
  /** true when this bumped an existing lesson's confidence instead of adding. */
  bumped?: boolean;
}

export interface LearnOutcome {
  projectId?: string;
  generatedAt: string;
  /** Every recurring pattern the aggregation surfaced (before the top-N cut). */
  patternsFound: DetectedPattern[];
  /** Lessons newly written to the store. */
  lessonsAdded: LearnedLesson[];
  /** Lessons that matched an existing lesson (confidence bumped, not re-added). */
  lessonsSkippedDuplicate: LearnedLesson[];
  /** One-line human summary of what happened. */
  summary: string;
}

/** Minimal shape `learnFromProject` needs from ProjectEngine's Project. */
export interface LearnableProject {
  id: string;
  title: string;
  steps: Array<{
    phase?: string;
    label?: string;
    status?: string;
    result?: string;
    chapterNumber?: number;
    continuityFlags?: ContinuityFlag[];
  }>;
}

export type GatherChaptersFn = (
  project: LearnableProject,
) => Promise<Array<{ id: string; number: number; title: string; text: string }>>;

/** Matches CraftCriticService.analyze — see craft-critic.ts. */
export interface CraftCriticLike {
  analyze(
    projectId: string,
    chapters: Array<{ id: string; number: number; title: string; text: string }>,
  ): CraftReport;
}

/** Matches DialogueAuditor.audit — see dialogue-auditor.ts. */
export interface DialogueAuditorLike {
  audit(text: string, chapterId?: string): DialogueReport;
}

// ═══════════════════════════════════════════════════════════
// Tuning
// ═══════════════════════════════════════════════════════════

/** A pattern must recur at least this many times to become a lesson. A single
 *  one-off flag is noise, not a durable lesson. */
const MIN_PATTERN_COUNT = 2;
/** Cap how many patterns we distil into lessons per run — the loudest signals
 *  first, so the lesson store stays high-signal and the AI call stays cheap. */
const TOP_N_PATTERNS = 6;
/** Base confidence for a freshly-learned lesson. Deliberately mid — a learned
 *  lesson is a hypothesis; it earns confidence as it recurs / gets accepted. */
const BASE_CONFIDENCE = 0.5;
/** Confidence bump applied when a pattern re-appears (dedup path). */
const DEDUP_BUMP = 0.05;
/** Ceiling for the recurrence-weighted base confidence. */
const MAX_LEARNED_CONFIDENCE = 0.75;

const SEVERITY_RANK: Record<'error' | 'warning' | 'info', number> = {
  error: 0,
  warning: 1,
  info: 2,
};

// ═══════════════════════════════════════════════════════════
// AI prompt (optional, free-tier phrasing pass)
// ═══════════════════════════════════════════════════════════

const DISTILL_SYSTEM_PROMPT = `You are a writing coach turning recurring editing-tool flags into DURABLE, REUSABLE lessons for an AI writing agent to apply BEFORE it writes, so it stops repeating the same mistakes.

You are given a list of PATTERNS. Each pattern has: a label (what the flag is about), a count (how many times it was flagged), a worst severity, and a sample flag. Write ONE lesson per pattern.

A good lesson is:
- ACTIONABLE and forward-looking — phrased as guidance for the NEXT draft ("Prefer strong verbs over -ly adverbs"), not a report of the past.
- SPECIFIC to the pattern, not generic.
- SHORT — one sentence, ideally under 20 words. You MAY end with the frequency in parentheses (e.g. "(flagged 14x)").
- Free of manuscript spoilers — reference the CRAFT issue, not plot details.

Return ONLY valid JSON. No markdown fences, no commentary. Close every brace and bracket.
Shape: {"lessons":[{"key":"<the pattern key, copied exactly>","lesson":"<the lesson text>"}]}
Include one entry per input pattern, each with the pattern's exact key.`;

// ═══════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════

export class LearningService {
  private lessons: LessonStore;

  /**
   * @param lessons the durable LessonStore this learner writes into. Required —
   *   without a store there is nowhere to close the loop.
   */
  constructor(lessons: LessonStore) {
    this.lessons = lessons;
  }

  /**
   * Aggregate findings across the given quality reports, distil the recurring
   * patterns into lessons, and write them into the LessonStore (dedup-aware).
   *
   * NEVER throws. Empty/malformed reports yield an empty-but-well-formed
   * outcome. A failing AI call falls back to deterministic lesson text. A
   * failing store write is swallowed (the pattern is simply not recorded).
   */
  async learnFromReports(
    input: LearnFromReportsInput,
    aiComplete?: AICompleteFn | null,
    aiSelectProvider?: AISelectProviderFn | null,
  ): Promise<LearnOutcome> {
    const generatedAt = new Date().toISOString();
    const projectId = input?.projectId;

    // ── (a) CODE aggregation → recurring patterns (no AI) ──
    const patterns = this.detectPatterns(input?.reports ?? []);

    // Only patterns that RECUR are lesson-worthy. Sort by severity then count so
    // the loudest, most-severe signals distil first; cap at TOP_N.
    const recurring = patterns
      .filter((p) => p.count >= MIN_PATTERN_COUNT)
      .sort((a, b) => {
        const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
        if (sev !== 0) return sev;
        return b.count - a.count;
      })
      .slice(0, TOP_N_PATTERNS);

    // ── (b) Phrase the patterns as lessons — ONE free-tier call, else code ──
    const phrased = await this.phrasePatterns(recurring, aiComplete, aiSelectProvider);

    // ── (c) Write to the LessonStore, dedup-aware ──
    const lessonsAdded: LearnedLesson[] = [];
    const lessonsSkippedDuplicate: LearnedLesson[] = [];

    for (const pattern of recurring) {
      const phrasedText = phrased.get(pattern.key) ?? this.deterministicLesson(pattern);
      const source = `learned:${pattern.kind}`;
      // The persisted lesson carries a stable, legible provenance tag encoding
      // the PATTERN it was learned from (e.g. "[learned:craft/adverbs]"). This
      // is the dedup anchor: the AI may phrase the same pattern slightly
      // differently each run, but the tag is deterministic — so a recurring
      // pattern reliably dedupes even when the wording drifts. The tag also
      // reads as clear provenance in the injected "# Lessons Learned" block.
      const text = `${phrasedText} ${this.provenanceTag(pattern)}`;
      // Recurrence-weighted confidence: a pattern flagged many times is a
      // stronger lesson than one flagged twice. Bounded so it never starts near-certain.
      const confidence = Math.min(
        MAX_LEARNED_CONFIDENCE,
        BASE_CONFIDENCE + Math.min(0.2, (pattern.count - MIN_PATTERN_COUNT) * 0.02),
      );

      const existing = this.findDuplicate(pattern, text);
      if (existing) {
        // DEDUP: don't re-add. Bump the known lesson's confidence instead — it
        // just recurred, so we trust it a little more.
        const bumped = await this.safeBump(existing.id, DEDUP_BUMP);
        lessonsSkippedDuplicate.push({
          text,
          source,
          confidence: bumped?.confidence ?? existing.confidence,
          bumped: true,
        });
        continue;
      }

      const written = await this.safeAdd({
        timestamp: generatedAt,
        // 'self-critique' is the closest VALID LessonStore source for "the agent
        // learned this from its own quality tools". The store coerces unknown
        // sources anyway; the fine-grained provenance ('learned:craft') is
        // preserved in the returned outcome's `source` and the lesson's tag.
        category: pattern.lessonCategory,
        lesson: text,
        source: 'self-critique',
        confidence,
        goalId: projectId,
      });

      if (written) {
        lessonsAdded.push({ text, source, confidence: written.confidence });
      }
      // If the write failed, we simply don't report it — never throw.
    }

    const summary = this.buildSummary(patterns.length, recurring.length, lessonsAdded.length, lessonsSkippedDuplicate.length);

    return {
      projectId,
      generatedAt,
      patternsFound: patterns,
      lessonsAdded,
      lessonsSkippedDuplicate,
      summary,
    };
  }

  /**
   * Gather the project's completed chapters, re-run the deterministic critics
   * over them (zero AI, zero cost), fold in the per-step post-draft
   * continuity flags, and hand the lot to learnFromReports.
   *
   * `craftCritic`/`dialogueAuditor` are accepted as arguments rather than
   * constructor deps: LearningService's own constructor only needs the
   * LessonStore (mirrors the ported interface), and the caller (the
   * project-completion hook) already has both services wired.
   *
   * NEVER throws — any failure gathering/analyzing degrades to an
   * empty-reports learnFromReports call (still well-formed, just no-op).
   */
  async learnFromProject(
    project: LearnableProject,
    gatherChapters: GatherChaptersFn,
    craftCritic: CraftCriticLike,
    dialogueAuditor: DialogueAuditorLike,
    aiComplete?: AICompleteFn | null,
    aiSelectProvider?: AISelectProviderFn | null,
  ): Promise<LearnOutcome> {
    const reports: LearnReportInput[] = [];
    try {
      const chapters = await gatherChapters(project);

      if (chapters.length > 0) {
        try {
          reports.push({ type: 'craft', report: craftCritic.analyze(project.id, chapters) });
        } catch {
          // A craft-critic failure must never block the dialogue/continuity folds.
        }
        for (const ch of chapters) {
          try {
            reports.push({ type: 'dialogue', report: dialogueAuditor.audit(ch.text, ch.id) });
          } catch {
            // Skip this chapter's dialogue audit; others still contribute.
          }
        }
      }

      const continuityFlags = (project?.steps ?? [])
        .flatMap((s) => (Array.isArray(s?.continuityFlags) ? s.continuityFlags : []));
      if (continuityFlags.length > 0) {
        reports.push({ type: 'continuity', report: continuityFlags });
      }
    } catch {
      // Gathering chapters failed entirely — fall through with whatever (if
      // anything) was collected; learnFromReports handles an empty list fine.
    }

    return this.learnFromReports({ projectId: project?.id, reports }, aiComplete, aiSelectProvider);
  }

  // ═══════════════════════════════════════════════════════════
  // (a) Pattern detection — pure CODE aggregation
  // ═══════════════════════════════════════════════════════════

  /**
   * Roll every finding across every report up into recurring patterns. Each
   * report type contributes its own natural grouping axis:
   *   craft      → CraftFlag.category         (e.g. "adverbs")
   *   dialogue   → speaker + sniffed issue     (e.g. "Alice / voice-formality")
   *   continuity → ContinuityFlag.kind         (e.g. "timeline")
   * A finding's worst severity wins for the pattern; counts accumulate.
   */
  detectPatterns(reports: LearnReportInput[]): DetectedPattern[] {
    const map = new Map<string, DetectedPattern>();

    for (const entry of reports ?? []) {
      if (!entry || typeof entry !== 'object' || !entry.report) continue;
      try {
        switch (entry.type) {
          case 'craft':
            this.foldCraft(entry.report as CraftReport, map);
            break;
          case 'dialogue':
            this.foldDialogue(entry.report as DialogueReport, map);
            break;
          case 'continuity':
            this.foldContinuity(entry.report as ContinuityFlag[], map);
            break;
          default:
            // Unknown report type — ignore rather than throw.
            break;
        }
      } catch {
        // A single malformed report must never sink the aggregation.
      }
    }

    return Array.from(map.values());
  }

  /** CraftFlag.category is a clean 9-value enum — group directly on it. */
  private foldCraft(report: CraftReport, map: Map<string, DetectedPattern>): void {
    const flags: CraftFlag[] = Array.isArray(report?.flags) ? report.flags : [];
    for (const f of flags) {
      if (!f || typeof f !== 'object') continue;
      const category = String(f.category ?? 'pacing').trim() || 'pacing';
      const key = `craft:${category}`;
      this.bumpPattern(map, {
        key,
        kind: 'craft',
        label: category,
        severity: this.normSeverity(f.severity),
        lessonCategory: 'writing_quality',
        sample: typeof f.description === 'string' ? f.description : undefined,
      });
    }
  }

  /**
   * DialogueFlag has NO discrete issue enum — just a freeform `reason`
   * string. Classify by sniffing the three known reason templates emitted by
   * dialogue-auditor.ts's flagMismatches() (voice-formality, line-length) and
   * flagSanitizedProfanity() (profanity-sanitization); anything unrecognized
   * degrades gracefully to voice-mismatch. Brittle to wording changes in
   * dialogue-auditor.ts — keep this in sync if those templates change.
   */
  private foldDialogue(report: DialogueReport, map: Map<string, DetectedPattern>): void {
    const flags: DialogueFlag[] = Array.isArray(report?.flags) ? report.flags : [];
    for (const f of flags) {
      if (!f || typeof f !== 'object') continue;
      const speaker = String(f.speaker ?? 'a character').trim() || 'a character';
      const issue = this.classifyDialogueReason(f.reason);
      const label = `${speaker} / ${issue}`;
      const key = `dialogue:${speaker.toLowerCase()}::${issue}`;
      this.bumpPattern(map, {
        key,
        kind: 'dialogue',
        label,
        severity: this.normSeverity(f.severity),
        lessonCategory: 'style_voice',
        sample: typeof f.reason === 'string' ? f.reason : undefined,
      });
    }
  }

  /** See dialogue-auditor.ts flagMismatches()/flagSanitizedProfanity() for the
   *  exact reason strings this sniffs. */
  private classifyDialogueReason(reason: unknown): string {
    const text = String(reason ?? '').toLowerCase();
    if (text.includes('unusually casual') || text.includes('unusually formal')) return 'voice-formality';
    if (text.includes('much longer') || text.includes('much shorter')) return 'line-length';
    if (text.includes('possible sanitization')) return 'profanity-sanitization';
    return 'voice-mismatch';
  }

  /** ContinuityFlag carries no severity field — default to 'warning' (a soft,
   *  correctable signal), same posture as the fork's character flags. */
  private foldContinuity(flags: ContinuityFlag[], map: Map<string, DetectedPattern>): void {
    const list: ContinuityFlag[] = Array.isArray(flags) ? flags : [];
    for (const f of list) {
      if (!f || typeof f !== 'object') continue;
      const kind = String(f.kind ?? 'contradiction').trim() || 'contradiction';
      const key = `continuity:${kind}`;
      this.bumpPattern(map, {
        key,
        kind: 'continuity',
        label: kind,
        severity: 'warning',
        lessonCategory: 'writing_quality',
        sample: typeof f.detail === 'string' ? f.detail : undefined,
      });
    }
  }

  /** Insert-or-accumulate one pattern occurrence into the rollup map. */
  private bumpPattern(
    map: Map<string, DetectedPattern>,
    seed: Omit<DetectedPattern, 'count'> & { count?: number },
  ): void {
    const existing = map.get(seed.key);
    if (!existing) {
      map.set(seed.key, {
        key: seed.key,
        kind: seed.kind,
        label: seed.label,
        count: seed.count ?? 1,
        severity: seed.severity,
        lessonCategory: seed.lessonCategory,
        sample: seed.sample,
      });
      return;
    }
    existing.count += seed.count ?? 1;
    // Keep the worst severity seen.
    if (SEVERITY_RANK[seed.severity] < SEVERITY_RANK[existing.severity]) {
      existing.severity = seed.severity;
    }
    // Keep the first non-empty sample.
    if (!existing.sample && seed.sample) existing.sample = seed.sample;
  }

  private normSeverity(sev: unknown): 'error' | 'warning' | 'info' {
    const s = String(sev ?? '').toLowerCase().trim();
    return s === 'error' || s === 'warning' || s === 'info' ? s : 'warning';
  }

  // ═══════════════════════════════════════════════════════════
  // (b) Phrasing — ONE optional free-tier call, deterministic fallback
  // ═══════════════════════════════════════════════════════════

  /**
   * Phrase the recurring patterns as lesson text. Returns a map key→lesson.
   * Attempts ONE free-tier AI call for polished phrasing; on any trouble (no
   * AI wired, transport error, malformed output) returns an EMPTY map and the
   * caller falls back to deterministicLesson() per pattern.
   */
  private async phrasePatterns(
    patterns: DetectedPattern[],
    aiComplete?: AICompleteFn | null,
    aiSelectProvider?: AISelectProviderFn | null,
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (patterns.length === 0) return out;
    if (!aiComplete || !aiSelectProvider) return out; // no AI → deterministic fallback

    let providerId: string;
    try {
      // FREE tier — pattern phrasing is cheap language work, never premium.
      providerId = aiSelectProvider('general').id;
    } catch {
      return out;
    }

    const userContent = [
      'PATTERNS (one lesson each, keep the exact key):',
      JSON.stringify(
        patterns.map((p) => ({
          key: p.key,
          label: p.label,
          count: p.count,
          severity: p.severity,
          sample: (p.sample || '').slice(0, 240),
        })),
        null,
        2,
      ),
    ].join('\n');

    let raw = '';
    try {
      const response = await aiComplete({
        provider: providerId,
        system: DISTILL_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userContent }],
        // A handful of one-sentence lessons is short. 1024 is ample.
        maxTokens: 1024,
        temperature: 0.3,
      });
      raw = response?.text ?? '';
    } catch {
      // Transport/AI failure → deterministic fallback (do NOT throw).
      return out;
    }

    const parsed = this.safeParseJson(raw);
    const list = Array.isArray(parsed?.lessons)
      ? parsed.lessons
      : Array.isArray(parsed)
        ? parsed
        : [];
    const validKeys = new Set(patterns.map((p) => p.key));
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const key = typeof item.key === 'string' ? item.key.trim() : '';
      const lesson = typeof item.lesson === 'string' ? item.lesson.trim() : '';
      if (!key || !lesson || !validKeys.has(key)) continue;
      out.set(key, this.clampLessonText(lesson));
    }
    return out;
  }

  /**
   * Deterministic lesson text from the counts — the guard when no AI phrased a
   * pattern. Reads like guidance, cites the frequency, and never spoils plot.
   */
  private deterministicLesson(p: DetectedPattern): string {
    const freq = `flagged ${p.count}x`;
    switch (p.kind) {
      case 'craft': {
        const category = p.label;
        switch (category) {
          case 'sag': return `Watch for sagging chapters (short + telling-heavy vs. the surrounding pace) (${freq}).`;
          case 'telling': return `Favor showing over telling — lean on physiology/action instead of naming emotions (${freq}).`;
          case 'adverbs': return `Cut -ly adverbs; prefer strong, specific verbs (${freq}).`;
          case 'passive': return `Reduce passive-voice constructions (${freq}).`;
          case 'filter': return `Cut filter words (saw/heard/felt/thought/realized) to close POV distance (${freq}).`;
          case 'monotony': return `Vary sentence length — avoid monotonous rhythm (${freq}).`;
          case 'dialogue_ratio': return `Balance the dialogue-to-narration ratio per chapter (${freq}).`;
          case 'beats': return `Align chapters more closely with the expected Save-the-Cat beat placement (${freq}).`;
          case 'pacing': return `Watch overall pacing — flagged repeatedly (${freq}).`;
          default: return `Watch for ${this.humanizeToken(category)} issues — they recur (${freq}).`;
        }
      }
      case 'dialogue': {
        const [speakerRaw, issue] = p.label.split(' / ');
        const speaker = (speakerRaw || 'a character').trim();
        if (issue === 'voice-formality') return `${speaker} drifts in formality mid-scene — hold their contraction/formality baseline steady (${freq}).`;
        if (issue === 'line-length') return `${speaker}'s lines swing far from their usual length — keep line length consistent with their voice (${freq}).`;
        if (issue === 'profanity-sanitization') return `${speaker} is marked high-profanity but their lines stay clean — don't sanitize their voice (${freq}).`;
        return `Keep ${speaker} in voice — mismatches recur (${freq}).`;
      }
      case 'continuity': {
        const kind = p.label;
        if (kind === 'contradiction') return `Watch for contradictions against established facts — they recur across chapters (${freq}).`;
        if (kind === 'timeline') return `Watch chronology in multi-chapter sequences — timeline inconsistencies recur (${freq}).`;
        if (kind === 'knowledge') return `Respect character knowledge horizons — knowledge-boundary breaks recur (${freq}).`;
        if (kind === 'red_herring') return `Handle red herrings and reveals carefully — pacing issues recur (${freq}).`;
        return `Check ${this.humanizeToken(kind)} consistency against the story bible (${freq}).`;
      }
      default:
        return `Recurring issue: ${p.label} (${freq}).`;
    }
  }

  private humanizeToken(token: string): string {
    return String(token || '')
      .replace(/[_/-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase() || 'this issue';
  }

  private clampLessonText(text: string): string {
    // Guard against a chatty model — keep lessons one sentence-ish.
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= 200) return cleaned;
    return cleaned.slice(0, 197).trimEnd() + '…';
  }

  private buildSummary(total: number, recurring: number, added: number, bumped: number): string {
    if (total === 0) return 'No findings to learn from.';
    if (recurring === 0) return `${total} pattern(s) seen, none recurred enough to become a lesson.`;
    const parts = [`${recurring} recurring pattern(s)`];
    parts.push(`${added} new lesson(s)`);
    if (bumped > 0) parts.push(`${bumped} existing lesson(s) reinforced`);
    return `Learned ${parts.join(', ')}.`;
  }

  // ═══════════════════════════════════════════════════════════
  // (c) LessonStore writes — dedup-aware, never throw
  // ═══════════════════════════════════════════════════════════

  /**
   * A stable, legible provenance tag encoding the pattern a lesson was learned
   * from, e.g. "[learned:craft/adverbs]". Deterministic per pattern key, so it
   * survives AI phrasing drift and serves as the dedup anchor.
   */
  private provenanceTag(p: DetectedPattern): string {
    // pattern.key is already "<kind>:<label-with-separators>" — reuse it
    // verbatim so the tag is exactly as stable as the aggregation key.
    return `[learned:${p.key.replace(/^[^:]+:/, `${p.kind}/`)}]`;
  }

  /**
   * Find an existing lesson that represents the SAME learned pattern.
   * Primary anchor: the stable provenance tag (survives AI-phrasing variance
   * between runs). Fallback: normalized text equality (lowercased, whitespace-
   * collapsed, frequency-count stripped so "(flagged 12x)" == "(flagged 14x)")
   * — this also dedupes against lessons authored WITHOUT a tag (e.g. legacy /
   * hand-written ones).
   */
  private findDuplicate(pattern: DetectedPattern, text: string): Lesson | null {
    const tag = this.provenanceTag(pattern);
    const target = this.normalizeLessonText(text);
    for (const l of this.lessons.getAll()) {
      if (typeof l.lesson === 'string' && l.lesson.includes(tag)) return l;
      if (target && this.normalizeLessonText(l.lesson) === target) return l;
    }
    return null;
  }

  private normalizeLessonText(text: string): string {
    return String(text || '')
      .toLowerCase()
      .replace(/\[learned:[^\]]*\]/g, '') // strip provenance tag (dedup handles it separately)
      .replace(/\(flagged\s+\d+x\)/g, '') // frequency count shouldn't defeat dedup
      .replace(/\d+(?:\.\d+)?/g, '#') // any remaining counts → placeholder
      .replace(/\s+/g, ' ')
      .replace(/[.!?,;:]+$/g, '')
      .trim();
  }

  /** addLesson wrapper that never throws — returns null on failure. */
  private async safeAdd(input: {
    timestamp: string;
    category: string;
    lesson: string;
    source: string;
    confidence: number;
    goalId?: string;
  }): Promise<Lesson | null> {
    try {
      return await this.lessons.addLesson(input);
    } catch {
      return null;
    }
  }

  /** adjustConfidence wrapper that never throws — returns null on failure. */
  private async safeBump(lessonId: string, delta: number): Promise<Lesson | null> {
    try {
      return await this.lessons.adjustConfidence(lessonId, delta);
    } catch {
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // JSON recovery (mirrors the sibling services' robust parser)
  // ═══════════════════════════════════════════════════════════

  private safeParseJson(text: string): any | null {
    if (!text || !text.trim()) return null;
    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    const start = cleaned.indexOf('{');
    const startArr = cleaned.indexOf('[');
    const open = start < 0 ? startArr : startArr < 0 ? start : Math.min(start, startArr);
    if (open < 0) return null;

    const lastBrace = cleaned.lastIndexOf('}');
    const lastBracket = cleaned.lastIndexOf(']');
    const end = Math.max(lastBrace, lastBracket);

    if (end > open) {
      const candidate = cleaned.substring(open, end + 1);
      const p = this.tryParse(candidate);
      if (p !== undefined) return p;
    }
    // Last resort: try the whole cleaned string.
    const p = this.tryParse(cleaned);
    return p === undefined ? null : p;
  }

  private tryParse(candidate: string): any | undefined {
    try {
      return JSON.parse(candidate);
    } catch {
      /* fall through */
    }
    try {
      const fixed = candidate
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/:\s*'([^']*)'/g, ': "$1"');
      return JSON.parse(fixed);
    } catch {
      return undefined;
    }
  }
}
