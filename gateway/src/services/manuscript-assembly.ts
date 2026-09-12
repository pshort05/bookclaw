/**
 * Deterministic manuscript assembly (run-review fix, 2026-06-30).
 *
 * The book-production "compile" step asked the model for a completion REPORT
 * (not the assembled novel), and the deep-revision "apply … full manuscript
 * rewrite" steps regenerated the whole book in one call and truncated to ~10% of
 * its length. So the only reliable full-novel artifact is the per-chapter files
 * on disk. This module assembles them deterministically (no model), preferring
 * the polished version of each chapter, in order, with the per-step headers
 * stripped — and validates the result didn't silently lose chapters/words.
 */

import { classifyChapterFile, isProseRole, type ChapterRole } from './pipeline/chapter-files.js';

export interface ChapterFile { name: string; content: string; mtime: number; }

// The deep-revision pipeline's "Apply {macro,scene-level,line-level} revisions
// (full manuscript rewrite)" steps save the ENTIRE rewritten manuscript as one
// file (no chapter number in the filename — see library/pipelines/deep-revision.json),
// slugified from the step label, e.g. "...-apply-macro-revisions-full-manuscript-rewrite-.md".
// This is the latest post-polish pass, so it should supersede write/polish for
// any chapter it contains.
const REVISION_RE = /apply-.*revisions.*full-manuscript-rewrite-?\.md$/i;

/** Parse a step-output filename into its chapter number + kind, or null.
 * Delegates to the shared classifier so the deterministic romance pipelines
 * (first draft / rewrite / consistency apply / de-AI sweep) are recognised too. */
export function parseChapterFile(name: string): { number: number; kind: ChapterRole } | null {
  const meta = classifyChapterFile(name);
  return meta ? { number: meta.number, kind: meta.role } : null;
}

/** Split a whole-manuscript revision-rewrite file into per-chapter chunks keyed
 * by chapter number, using "# Chapter N" / "## Chapter N: Title" headings — the
 * shape the deep-revision "apply revisions" steps are instructed to preserve. */
function splitRevisionChapters(content: string): Map<number, string> {
  const chapters = new Map<number, string>();
  let number: number | null = null;
  let buf: string[] = [];
  const flush = () => { if (number !== null && buf.length) chapters.set(number, buf.join('\n').trim()); };
  for (const line of String(content ?? '').split('\n')) {
    const m = /^#{1,2}\s+Chapter\s+(\d+)\b/i.exec(line);
    if (m) {
      flush();
      number = Number(m[1]);
      buf = [line];
    } else if (number !== null) {
      buf.push(line);
    }
  }
  flush();
  return chapters;
}

// Prose passes ranked by pipeline order — the later pass is the canonical text.
// write < polish (the older pipelines); first draft < rewrite < consistency
// apply < de-AI sweep (the deterministic romance pipelines). Non-prose roles
// (scene brief, improvement plan, consistency audit) are absent by design.
// Pipeline order, so a later pass beats an earlier one for the same chapter.
// `intimacy` outranks `humanize` because it is the FINAL pass in the spicy
// pipelines (romance-spicy, romance-*-full); `apply-edits` is the applying pass
// of the editorial-* pipelines, which run alone over a finished manuscript.
const ROLE_RANK: Partial<Record<ChapterRole, number>> = {
  write: 1, polish: 2,
  'first-draft': 10, rewrite: 11, 'consistency-apply': 12,
  humanize: 13, 'humanize-pass': 13, intimacy: 14, 'apply-edits': 14,
};

/**
 * One file per chapter number: polish wins over write (the canonical output);
 * within the same kind, the newest mtime wins. A deep-revision whole-manuscript
 * rewrite (see REVISION_RE) then overrides write/polish for any chapter number
 * it covers — it's a later, post-polish pass. Chapters it doesn't cover keep
 * their write/polish pick. Returned ordered by chapter number. Non-chapter,
 * non-revision files are dropped.
 *
 * Minimal-version note: if more than one revision-rewrite file exists (e.g. a
 * truncated pass that continued in a later run), only the single newest by
 * mtime is used — earlier revision passes are not merged in chapter-by-chapter.
 */
export function pickLatestChapters(files: ChapterFile[]): ChapterFile[] {
  const best = new Map<number, { file: ChapterFile; kind: ChapterRole | 'revision' }>();
  for (const f of files) {
    const meta = parseChapterFile(f.name);
    if (!meta || !isProseRole(meta.kind)) continue;                         // briefs/plans/audits aren't the chapter
    const cur = best.get(meta.number);
    if (!cur) { best.set(meta.number, { file: f, kind: meta.kind }); continue; }
    const rank = ROLE_RANK[meta.kind] ?? 0;
    const curRank = cur.kind === 'revision' ? Infinity : (ROLE_RANK[cur.kind] ?? 0);
    const better =
      rank > curRank ||                                                     // a later pass beats an earlier one
      (rank === curRank && f.mtime > cur.file.mtime);                       // newer same-pass wins
    if (better) best.set(meta.number, { file: f, kind: meta.kind });
  }

  const revisionFiles = files.filter((f) => REVISION_RE.test(f.name));
  const latestRevision = revisionFiles.sort((a, b) => b.mtime - a.mtime)[0];
  if (latestRevision) {
    for (const [number, content] of splitRevisionChapters(latestRevision.content)) {
      best.set(number, { file: { name: latestRevision.name, content, mtime: latestRevision.mtime }, kind: 'revision' });
    }
  }

  return [...best.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v.file);
}

/** Strip the working-draft headers a chapter file carries above its real
 * "## Chapter N" heading: the injected "# <step label>" heading every step
 * file is written with (any heading level, possibly repeated) and a redundant
 * duplicate "# Chapter N" that sits directly above the titled heading. A lone
 * "# Chapter N" that IS the heading is kept. (run-review #9, 2026-06-30; widened
 * from an enumerated Polish|Write list to any step label, finding #4 2026-09-12
 * — the chapter classifier now admits first-draft/rewrite/consistency-apply/
 * humanize/etc., and every one of those labels ends in "Chapter N" too.) */
export function normalizeChapter(content: string): string {
  let text = String(content ?? '').replace(/^﻿/, '');
  const stripLeading = () => {
    let changed = true;
    while (changed) {
      changed = false;
      // Any "<role prefix> Chapter N" working header (any heading level), e.g.
      // "Polish Chapter 5", "First Draft — Chapter 3", "Consistency Apply —
      // Chapter 7", "Humanize — De-AI Sweep — Chapter 12" — every chapter
      // step's label ends in "Chapter N" (library/pipelines/*.json). The
      // leading negative lookahead requires a non-empty prefix before
      // "Chapter" so a bare "# Chapter N" heading (the real, untitled chapter
      // heading) is never matched. Bare only (review #4): require the line to
      // END after the number, so a real titled heading like "# Write Chapter
      // 5: The Reckoning" is NOT eaten.
      const a = text.replace(/^\s*#{1,3}[ \t]+(?!Chapter\s+\d+[ \t]*(?:\n|$))\S.*?\bChapter\s+\d+[ \t]*(?:\n|$)/i, '');
      if (a !== text) { text = a; changed = true; }
      // Leading blank lines / horizontal rules left behind.
      const b = text.replace(/^(?:\s*(?:---|\*\*\*)\s*\n)+/, '').replace(/^\s*\n+/, '');
      if (b !== text) { text = b; changed = true; }
    }
  };
  stripLeading();
  // A redundant "# Chapter N" immediately above ANY other heading (titled or
  // numbered — review #3) is a duplicate working header — drop it. A "# Chapter N"
  // followed by prose is the real heading and is kept.
  text = text.replace(
    /^\s*#{1,2}\s+Chapter\s+\d+\s*\n+(?=\s*#{1,3}\s+\S)/i,
    '',
  );
  stripLeading();
  return text.trim();
}

/** Prose word count — excludes markdown heading lines so "~80,000 words" reflects
 * the actual story, not chapter titles. */
function countWords(s: string): number {
  const prose = String(s ?? '')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join(' ')
    .trim();
  return prose ? prose.split(/\s+/).length : 0;
}

/** Assemble the latest chapters into a single ordered markdown manuscript. */
export function assembleManuscript(
  files: ChapterFile[], opts: { title: string; author?: string },
): { markdown: string; chapterCount: number; wordCount: number } {
  const chapters = pickLatestChapters(files).map((f) => normalizeChapter(f.content)).filter(Boolean);
  const head = `# ${opts.title}${opts.author ? `\n\n*by ${opts.author}*` : ''}`;
  const markdown = chapters.length ? `${head}\n\n${chapters.join('\n\n')}\n` : '';
  return { markdown, chapterCount: chapters.length, wordCount: countWords(chapters.join('\n')) };
}

/**
 * Guard against a silently-broken manuscript: missing chapters or a word-count
 * collapse (the failure mode that destroyed the reviewed run). With no
 * expectations, only an empty manuscript fails.
 */
export function validateAssembly(
  result: { chapterCount: number; wordCount: number },
  opts: { expectedChapters?: number; minWords?: number },
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (result.chapterCount === 0 || result.wordCount === 0) problems.push('Manuscript is empty — no chapter content assembled.');
  if (opts.expectedChapters && result.chapterCount < opts.expectedChapters) {
    problems.push(`Missing chapters: assembled ${result.chapterCount} of ${opts.expectedChapters} expected.`);
  }
  if (opts.minWords && result.wordCount < opts.minWords) {
    problems.push(`Word count too low: ${result.wordCount} words (expected ≥ ${opts.minWords}).`);
  }
  return { ok: problems.length === 0, problems };
}
