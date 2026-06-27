/**
 * Orchestration for the Try-Fail & Escalation Auditor (TODO #15).
 *
 * Synchronous, single-LLM-call audit (modeled on plot-promises): select the
 * book's chapter files, read + optionally condense them, make ONE structured
 * extraction call, parse it tolerantly, and assemble the deterministic report.
 * Fail-soft: a book with zero chapters returns a valid TryFailReport, never
 * throws.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { selectChapterFiles, findCombinedManuscript, splitManuscriptIntoChapters } from '../consistency/audit.js';
import { buildAuditPrompt, condenseChapters, parseAuditExtraction } from './extract.js';
import { assembleReport } from './score.js';
import type { TryFailReport } from './types.js';

export interface TryFailAuditDeps {
  slug: string;
  dataDir: string;
  /** Single structured-completion call; returns `{content}` or `{text}`. */
  aiComplete: (req: any) => Promise<{ content?: string; text?: string }>;
  /** Resolve the provider for a task type (honoring a preferred provider). */
  aiSelect: (taskType: string, preferredProvider?: string) => { id: string };
  /** Optional per-run model override (provider + exact model id). */
  model?: { provider?: string; model?: string };
}

/** Parse a chapter file's number from its stem (chapter-3, chapter-03, …). */
function chapterNumberOf(name: string): number {
  const m = name.toLowerCase().replace(/\.md$/, '').match(/chapter-(\d+)\b/);
  return m ? parseInt(m[1], 10) : 0;
}

export async function runTryFailAudit(deps: TryFailAuditDeps): Promise<TryFailReport> {
  const { slug, dataDir, aiComplete, aiSelect, model } = deps;

  // Resolve the model up front so it appears in the report even on the no-chapter
  // path. Only honor the pinned model when the requested provider was actually
  // selected (selectProvider may fall back if it's unavailable) — a model id sent
  // to the wrong provider would error the single call.
  const provider = aiSelect('consistency', model?.provider);
  const resolvedModel: { provider?: string; model?: string } = {
    provider: provider.id,
    model: model?.provider && provider.id === model.provider ? model?.model : undefined,
  };

  // Enumerate chapter-prose files. Fail-soft: missing dir / read errors → empty.
  let files: string[] = [];
  if (dataDir && existsSync(dataDir)) {
    try {
      files = selectChapterFiles(readdirSync(dataDir));
    } catch {
      files = [];
    }
  }

  const chapters: { n: number; text: string }[] = [];
  for (const f of files) {
    try {
      chapters.push({ n: chapterNumberOf(f), text: readFileSync(join(dataDir, f), 'utf-8') });
    } catch {
      // skip an unreadable chapter file
    }
  }

  // Fallback for imported books whose whole text lives in one combined file
  // (manuscript.md / draft.md) with no chapter-N files — mirror the consistency
  // auditor, which analyses the identical book via findCombinedManuscript().
  if (chapters.length === 0 && dataDir && existsSync(dataDir)) {
    try {
      const combined = findCombinedManuscript(readdirSync(dataDir));
      if (combined) {
        const text = readFileSync(join(dataDir, combined), 'utf-8');
        splitManuscriptIntoChapters(text).forEach((seg, i) => {
          if (seg.text.trim()) chapters.push({ n: i + 1, text: seg.text });
        });
      }
    } catch {
      // fall through to the no-chapter report
    }
  }

  // No chapters → a valid report with a single note, never a throw.
  if (chapters.length === 0) {
    const report = assembleReport(
      slug,
      { protagonists: [], attempts: [], crucibleSignals: [] },
      false,
      resolvedModel,
    );
    report.findings.unshift({
      severity: 'low',
      category: 'no_try_fail_cycle',
      detail: 'No chapter prose was found for this book, so no try-fail cycles could be assessed.',
    });
    return report;
  }

  const { chapters: condensedChapters, condensed } = condenseChapters(chapters);
  const { system, user } = buildAuditPrompt(condensedChapters);

  const res = await aiComplete({
    provider: resolvedModel.provider,
    model: resolvedModel.model,
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 16000,
    temperature: 0.1,
  });

  const raw = res.content ?? res.text ?? '';
  const extraction = parseAuditExtraction(raw);
  return assembleReport(slug, extraction, condensed, resolvedModel);
}
