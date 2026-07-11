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

export interface ChapterFile { name: string; content: string; mtime: number; }

// Allow an optional title suffix after the number (a step label like "Write
// Chapter 1: The Night Shift" sanitizes to ...-write-chapter-1-the-night-shift.md).
const CHAPTER_RE = /(write|polish)-chapter-(\d+)(?:-[^/]*)?\.md$/i;

// The deep-revision pipeline's "Apply {macro,scene-level,line-level} revisions
// (full manuscript rewrite)" steps save the ENTIRE rewritten manuscript as one
// file (no chapter number in the filename — see library/pipelines/deep-revision.json),
// slugified from the step label, e.g. "...-apply-macro-revisions-full-manuscript-rewrite-.md".
// This is the latest post-polish pass, so it should supersede write/polish for
// any chapter it contains.
const REVISION_RE = /apply-.*revisions.*full-manuscript-rewrite-?\.md$/i;

/** Parse a step-output filename into its chapter number + kind, or null. */
export function parseChapterFile(name: string): { number: number; kind: 'write' | 'polish' } | null {
  const m = CHAPTER_RE.exec(name);
  if (!m) return null;
  return { number: Number(m[2]), kind: m[1].toLowerCase() as 'write' | 'polish' };
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
  const best = new Map<number, { file: ChapterFile; kind: 'write' | 'polish' | 'revision' }>();
  for (const f of files) {
    const meta = parseChapterFile(f.name);
    if (!meta) continue;
    const cur = best.get(meta.number);
    if (!cur) { best.set(meta.number, { file: f, kind: meta.kind }); continue; }
    const better =
      (meta.kind === 'polish' && cur.kind !== 'polish') ||                 // polish beats write
      (meta.kind === cur.kind && f.mtime > cur.file.mtime);                 // newer same-kind wins
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
 * "## Chapter N" heading: "# Polish/Write Chapter N" step labels (any heading
 * level, possibly repeated) and a redundant duplicate "# Chapter N" that sits
 * directly above the titled heading. A lone "# Chapter N" that IS the heading is
 * kept. (run-review #9, 2026-06-30.) */
export function normalizeChapter(content: string): string {
  let text = String(content ?? '').replace(/^﻿/, '');
  const stripLeading = () => {
    let changed = true;
    while (changed) {
      changed = false;
      // "# Polish Chapter N" / "## Write Chapter N" working header (any level).
      // Bare only (review #4): require the line to END after the number, so a
      // real titled heading like "# Write Chapter 5: The Reckoning" is NOT eaten.
      const a = text.replace(/^\s*#{1,3}\s+(?:Polish|Write)\s+Chapter\s+\d+[ \t]*(?:\n|$)/i, '');
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
