/**
 * Analyze-then-apply polish (Flagship Plan 4, Task 3).
 *
 * Replaces a blind "polish/rewrite" pass with a measured one: run the
 * deterministic critics (CraftCriticService, DialogueAuditor — both zero-AI,
 * craft-critic.ts / dialogue-auditor.ts) over the chapter, merge in Plan 3's
 * post-draft continuity flags (continuity-check.ts's `ContinuityFlag`), and
 * turn the result into a targeted rewrite instruction that names the SPECIFIC
 * issues to fix — not a fixed checklist applied blindly to every chapter.
 *
 * Reuses the existing services; does not reimplement any of their detection
 * logic.
 */
import type { CraftFlag, CraftReport } from '../craft-critic.js';
import type { DialogueFlag, DialogueReport } from '../dialogue-auditor.js';
import type { ContinuityFlag } from '../consistency/continuity-check.js';

export interface CraftCriticLike {
  analyze(projectId: string, chapters: Array<{ id: string; number: number; title: string; text: string }>): CraftReport;
}

export interface DialogueAuditorLike {
  audit(text: string, chapterId?: string): DialogueReport;
}

export interface Findings {
  chapterNumber: number;
  craftFlags: CraftFlag[];
  dialogueFlags: DialogueFlag[];
  continuityFlags: ContinuityFlag[];
  hasFindings: boolean;
}

/**
 * Run the deterministic critics + merge in continuity flags for ONE chapter.
 * `craftCritic`/`dialogueAuditor` are zero-AI (no router, no cost) — safe to
 * run on every polish step.
 */
export function analyzeChapter(args: {
  text: string;
  chapterNumber: number;
  chapterId?: string;
  craftCritic: CraftCriticLike;
  dialogueAuditor: DialogueAuditorLike;
  continuityFlags?: ContinuityFlag[];
}): Findings {
  const chapterId = args.chapterId ?? `ch-${args.chapterNumber}`;
  const craftReport = args.craftCritic.analyze('analyze-apply', [
    { id: chapterId, number: args.chapterNumber, title: `Chapter ${args.chapterNumber}`, text: args.text },
  ]);
  const dialogueReport = args.dialogueAuditor.audit(args.text, chapterId);
  const continuityFlags = args.continuityFlags ?? [];

  return {
    chapterNumber: args.chapterNumber,
    craftFlags: craftReport.flags,
    dialogueFlags: dialogueReport.flags,
    continuityFlags,
    hasFindings: craftReport.flags.length > 0 || dialogueReport.flags.length > 0 || continuityFlags.length > 0,
  };
}

/** Pure block builder: turns Findings into a bulleted list of named issues. */
export function describeFindings(findings: Findings): string {
  const lines: string[] = ['## Analysis Findings — fix ONLY these issues'];
  for (const f of findings.craftFlags) {
    lines.push(`- [craft:${f.category}] ${f.description}${f.suggestion ? ` → ${f.suggestion}` : ''}`);
  }
  for (const f of findings.dialogueFlags) {
    lines.push(`- [dialogue:${f.speaker}] ${f.reason}`);
  }
  for (const f of findings.continuityFlags) {
    lines.push(`- [continuity:${f.kind}] ${f.detail}`);
  }
  return lines.join('\n');
}
