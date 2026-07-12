/**
 * BookClaw Revision Orchestrator
 *
 * A thin aggregator over detectors we already have — presentation, not new
 * detection. Fans a chapter set out to the existing local-heuristic
 * detectors (craft, dialogue, mechanical) plus the already-computed
 * continuity/voice-drift signals, normalizes them into one `Finding` shape,
 * dedupes, and sorts into a single prioritized `RevisionReport`.
 *
 * Each pass is isolated: a missing dependency is a graceful SKIP, and a
 * throwing pass is caught and recorded in `passesSkipped` — one bad pass
 * never aborts the others.
 *
 * Ported near-verbatim from the AuthorAgent fork's
 * `gateway/src/services/revision-orchestrator.ts` (Finding/RevisionReport
 * shapes, REVISION_PASSES, the SKIP sentinel, dedupe/sort) — the pass
 * runners themselves are rewritten against BookClaw's detectors.
 */

import type { CraftReport } from './craft-critic.js';
import type { DialogueReport } from './dialogue-auditor.js';
import type { MechanicalReport } from './writing-judge.js';
import type { VoiceDriftReport, DriftFlag } from './character-voices.js';
import type { ContinuityFlag } from './consistency/continuity-check.js';

/** Structural (duck-typed) view of `CraftCriticService` — only the method
 *  this orchestrator calls. Keeps the dependency detector-agnostic and easy
 *  to fake in tests without importing the full class. */
export interface CraftCriticLike {
  analyze(
    projectId: string,
    chapters: Array<{ id: string; number: number; title: string; text: string }>,
  ): CraftReport;
}

/** Structural view of `DialogueAuditor`. */
export interface DialogueAuditorLike {
  audit(text: string, chapterId?: string): DialogueReport;
}

/** Structural view of `WritingJudgeService`. */
export interface WritingJudgeLike {
  mechanicalScreen(text: string): MechanicalReport;
}

/** Structural view of `CharacterVoicesService`. */
export interface CharacterVoicesLike {
  detectDrift(input: {
    projectId: string;
    chapterNumber: number;
    chapterText: string;
    characterNames: string[];
    characterAliases?: Record<string, string[]>;
  }): Promise<VoiceDriftReport>;
}

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export type FindingSeverity = 'error' | 'warning' | 'info';

/** A single normalized issue produced by any specialist pass. */
export interface Finding {
  /** The pass that produced this finding (e.g. 'continuity', 'mechanical'). */
  pass: string;
  /** The pass-specific category (e.g. 'sag', 'dialogue', 'contradiction'). */
  category: string;
  severity: FindingSeverity;
  /** Optional location hint — a chapter id, character name… */
  location?: string;
  /** What is wrong. */
  description: string;
  /** How to fix it, when the analyzer offered one. */
  suggestion?: string;
}

export interface RevisionReport {
  projectId?: string;
  chapterId?: string;
  generatedAt: string;
  totalFindings: number;
  findingsBySeverity: Record<FindingSeverity, number>;
  findingsByPass: Record<string, number>;
  findings: Finding[];
  /** Passes that ran (successfully, even if they produced zero findings). */
  passesRun: string[];
  /** Passes requested but skipped — missing dependency, or the pass threw. */
  passesSkipped: string[];
}

export interface RevisionChapterInput {
  id: string;
  number: number;
  title: string;
  text: string;
  /** Already-computed continuity flags for this chapter (no new AI call is
   *  made here — the continuity pass only reads this field). */
  continuityFlags?: ContinuityFlag[];
}

export interface RevisionReportInput {
  projectId?: string;
  chapters: RevisionChapterInput[];
  /** Optional filter — run only these passes (by name). Unknown names are
   *  ignored; omitting the field runs every registered pass. */
  passes?: string[];
  /** Canonical character-name allowlist for the voice-drift pass, resolved by
   *  the caller (route) from the project's entity DB. Empty/omitted → the
   *  voice pass attributes nothing (returns no findings). */
  characterNames?: string[];
}

/** The specialist analyzers this orchestrator composes. All optional: a
 *  pass whose analyzer is missing is skipped gracefully. */
export interface RevisionOrchestratorDeps {
  craftCritic?: CraftCriticLike | null;
  dialogueAuditor?: DialogueAuditorLike | null;
  writingJudge?: WritingJudgeLike | null;
  characterVoices?: CharacterVoicesLike | null;
}

/** Canonical ordering of severities for sorting (error first). */
const SEVERITY_RANK: Record<FindingSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/** Map a raw ContinuityFlag.kind to a Finding severity — contradictions are
 *  hard errors; timeline/knowledge/red-herring flags are softer warnings. */
const CONTINUITY_KIND_SEVERITY: Record<ContinuityFlag['kind'], FindingSeverity> = {
  contradiction: 'error',
  timeline: 'warning',
  knowledge: 'warning',
  red_herring: 'warning',
};

/** Voice-drift findings are a soft, possibly-intentional signal — always warn. */
const VOICE_DRIFT_SEVERITY: FindingSeverity = 'warning';

/** The registered pass names, in their canonical run/sort order. */
export const REVISION_PASSES = ['craft', 'dialogue', 'continuity', 'voice', 'mechanical'] as const;
export type RevisionPassName = (typeof REVISION_PASSES)[number];

/**
 * Sentinel a pass returns to signal "not applicable — skip me" (as opposed to
 * "ran and found nothing", which returns []). Typed as Finding[] so runners
 * can return it directly; identity-compared in buildReport().
 */
const SKIP = [] as unknown as Finding[] & { __skip: true };

// ═══════════════════════════════════════════════════════════
// Orchestrator
// ═══════════════════════════════════════════════════════════

export class RevisionOrchestrator {
  private deps: RevisionOrchestratorDeps;

  constructor(deps: RevisionOrchestratorDeps = {}) {
    this.deps = deps;
  }

  /**
   * Run the specialist revision passes over every chapter and aggregate
   * their findings into one prioritized report. Each pass is isolated per
   * chapter: a throwing pass never aborts the others and is recorded in
   * `passesSkipped`.
   */
  async buildReport(input: RevisionReportInput): Promise<RevisionReport> {
    const chapters = input.chapters ?? [];
    const wanted = this.resolveRequestedPasses(input.passes);

    const findings: Finding[] = [];
    const passesRun = new Set<string>();
    const passesSkipped = new Set<string>();

    for (const chapter of chapters) {
      const passRunners: Array<{ name: RevisionPassName; run: () => Promise<Finding[]> }> = [
        { name: 'craft', run: () => this.runCraftPass(input.projectId, chapter) },
        { name: 'dialogue', run: () => this.runDialoguePass(chapter) },
        { name: 'continuity', run: () => this.runContinuityPass(chapter) },
        { name: 'voice', run: () => this.runVoicePass(input.projectId, chapter, input.characterNames) },
        { name: 'mechanical', run: () => this.runMechanicalPass(chapter) },
      ];

      for (const pass of passRunners) {
        if (!wanted.has(pass.name)) continue;
        try {
          const produced = await pass.run();
          if (produced === SKIP) {
            passesSkipped.add(pass.name);
            continue;
          }
          findings.push(...produced);
          passesRun.add(pass.name);
        } catch {
          // One pass failing on one chapter must never abort the rest.
          passesSkipped.add(pass.name);
        }
      }
    }

    // A pass that ran successfully on at least one chapter is "run" even if
    // it was skipped (missing prerequisite) on another.
    for (const name of passesRun) passesSkipped.delete(name);

    const deduped = this.dedupe(findings);
    const sorted = this.sort(deduped);

    const findingsBySeverity: Record<FindingSeverity, number> = { error: 0, warning: 0, info: 0 };
    const findingsByPass: Record<string, number> = {};
    for (const f of sorted) {
      findingsBySeverity[f.severity]++;
      findingsByPass[f.pass] = (findingsByPass[f.pass] ?? 0) + 1;
    }

    return {
      projectId: input.projectId,
      chapterId: chapters.length === 1 ? chapters[0].id : undefined,
      generatedAt: new Date().toISOString(),
      totalFindings: sorted.length,
      findingsBySeverity,
      findingsByPass,
      findings: sorted,
      passesRun: Array.from(passesRun),
      passesSkipped: Array.from(passesSkipped),
    };
  }

  // ── Pass: craft (CraftCriticService.analyze, severity pass-through) ──

  private async runCraftPass(projectId: string | undefined, chapter: RevisionChapterInput): Promise<Finding[]> {
    const critic = this.deps.craftCritic;
    if (!critic) return SKIP;

    const report = critic.analyze(projectId ?? 'revision-report', [
      { id: chapter.id, number: chapter.number, title: chapter.title, text: chapter.text },
    ]);

    return (report.flags ?? []).map(flag => ({
      pass: 'craft',
      category: flag.category,
      severity: flag.severity,
      location: chapter.id,
      description: flag.description,
      suggestion: flag.suggestion,
    }));
  }

  // ── Pass: dialogue (DialogueAuditor.audit, severity pass-through) ──

  private async runDialoguePass(chapter: RevisionChapterInput): Promise<Finding[]> {
    const auditor = this.deps.dialogueAuditor;
    if (!auditor) return SKIP;

    const report = auditor.audit(chapter.text, chapter.id);

    return (report.flags ?? []).map(flag => ({
      pass: 'dialogue',
      category: 'dialogue',
      severity: flag.severity,
      location: flag.speaker || chapter.id,
      description: flag.reason,
    }));
  }

  // ── Pass: continuity (reads already-persisted flags — NO new AI call) ──

  private async runContinuityPass(chapter: RevisionChapterInput): Promise<Finding[]> {
    const flags = chapter.continuityFlags;
    if (!flags) return SKIP;

    return flags.map(flag => ({
      pass: 'continuity',
      category: flag.kind,
      severity: CONTINUITY_KIND_SEVERITY[flag.kind],
      location: chapter.id,
      description: flag.detail,
      suggestion: flag.span ? `Evidence: "${flag.span}"` : undefined,
    }));
  }

  // ── Pass: voice (CharacterVoicesService.detectDrift, severity hardcoded 'warning') ──

  private async runVoicePass(projectId: string | undefined, chapter: RevisionChapterInput, characterNames: string[] = []): Promise<Finding[]> {
    const cv = this.deps.characterVoices;
    if (!cv || !projectId) return SKIP;

    // detectDrift needs a canonical character-name allowlist to attribute
    // dialogue, resolved by the caller (route) from the project's entity DB
    // and passed via buildReport's `characterNames`. Empty → attributes
    // nothing (returns no findings), which is a graceful degrade, not an error.
    const report = await cv.detectDrift({
      projectId,
      chapterNumber: chapter.number,
      chapterText: chapter.text,
      characterNames,
    });

    const findings: Finding[] = [];
    for (const character of report.characters ?? []) {
      for (const flag of character.flags ?? []) {
        // detectDrift already filters to z>2 internally, but the contract is
        // explicit: only significant drift becomes a Finding.
        if (flag.zScore <= 2) continue;
        findings.push(this.driftFlagToFinding(flag));
      }
    }
    return findings;
  }

  private driftFlagToFinding(flag: DriftFlag): Finding {
    return {
      pass: 'voice',
      category: 'voice_drift',
      severity: VOICE_DRIFT_SEVERITY,
      location: flag.characterName,
      description: `${flag.characterName}: ${flag.marker} drift (expected ~${flag.expected}, got ${flag.actual}, z=${flag.zScore}).`,
      suggestion: flag.note,
    };
  }

  // ── Pass: mechanical (WritingJudgeService.mechanicalScreen, pass-through) ──

  private async runMechanicalPass(chapter: RevisionChapterInput): Promise<Finding[]> {
    const judge = this.deps.writingJudge;
    if (!judge) return SKIP;

    const report = judge.mechanicalScreen(chapter.text);

    return (report.issues ?? []).map(issue => ({
      pass: 'mechanical',
      category: issue.category,
      severity: issue.severity,
      location: chapter.id,
      description: issue.description,
      suggestion: issue.examples?.length ? `Examples: ${issue.examples.slice(0, 3).join(', ')}` : undefined,
    }));
  }

  // ── Aggregation helpers ──

  /** Resolve which passes to run. Unknown names are ignored; omitting the
   *  filter runs every registered pass. */
  private resolveRequestedPasses(passes?: string[]): Set<string> {
    if (!passes || passes.length === 0) return new Set(REVISION_PASSES);
    const wanted = new Set<string>();
    for (const name of passes) {
      if ((REVISION_PASSES as readonly string[]).includes(name)) wanted.add(name);
    }
    return wanted;
  }

  /**
   * De-duplicate findings. Two findings are duplicates when they share the
   * same category + location AND have a "similar" description (normalized:
   * lowercased, whitespace-collapsed, trailing punctuation trimmed, and
   * numbers collapsed to "#" so "3 adverbs" == "5 adverbs"). The first
   * occurrence is kept.
   */
  private dedupe(findings: Finding[]): Finding[] {
    const seen = new Set<string>();
    const out: Finding[] = [];
    for (const f of findings) {
      const key = `${f.category}|${f.location ?? ''}|${this.normalizeDescription(f.description)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
    return out;
  }

  private normalizeDescription(desc: string): string {
    return (desc || '')
      .toLowerCase()
      .replace(/\d+(?:\.\d+)?/g, '#') // collapse numbers so counts/rates don't defeat dedupe
      .replace(/\s+/g, ' ')
      .replace(/[.!?,;:]+$/g, '')
      .trim();
  }

  /**
   * Sort by severity (error > warning > info), then by pass order (the
   * canonical REVISION_PASSES ordering), so the most urgent, most structural
   * findings surface first.
   */
  private sort(findings: Finding[]): Finding[] {
    const passOrder = new Map<string, number>(REVISION_PASSES.map((p, i) => [p, i]));
    return [...findings].sort((a, b) => {
      const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (sev !== 0) return sev;
      const pa = passOrder.get(a.pass) ?? 999;
      const pb = passOrder.get(b.pass) ?? 999;
      return pa - pb;
    });
  }
}
