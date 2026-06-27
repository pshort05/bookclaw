/**
 * Resolve a finding's chapter LABEL (e.g. `chapter-3`) to the actual on-disk file
 * and the focused chapter prose, for the consistency apply-fix feature.
 *
 * Two book layouts are handled, mirroring the auditor's own enumeration:
 *  - Per-chapter book (generation pipeline): each chapter is its own file
 *    (`chapter-3-polish.md`). The chapter prose IS the whole file, so fileText and
 *    chapterText are identical.
 *  - Combined-manuscript book (imported): the whole manuscript lives in one file
 *    (`manuscript.md`). The model is shown the focused chapter SEGMENT, but
 *    anchoring/apply operate on the WHOLE file (fileText), so a substring edit
 *    lands in the right place within the combined file.
 *
 * Returns null when nothing resolves (no matching chapter file and no combined
 * manuscript, or the segment label can't be matched).
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { selectChapterFiles, findCombinedManuscript, splitManuscriptIntoChapters } from './audit.js';

/** Parse a chapter number from a label/stem (chapter-3, chapter-03, …); -1 if none. */
function chapterNumberOf(label: string): number {
  const m = label.toLowerCase().replace(/\.md$/, '').match(/chapter-(\d+)\b/);
  return m ? parseInt(m[1], 10) : -1;
}

export function resolveChapterFile(
  dataDir: string,
  chapterLabel: string,
): { filename: string; fileText: string; chapterText: string } | null {
  if (!dataDir || !existsSync(dataDir)) return null;

  let names: string[];
  try {
    names = readdirSync(dataDir);
  } catch {
    return null;
  }

  // Per-chapter book: match the label's chapter number to a chapter file's number.
  const wantNum = chapterNumberOf(chapterLabel);
  if (wantNum >= 0) {
    const chapterFiles = selectChapterFiles(names);
    const match = chapterFiles.find((f) => chapterNumberOf(f) === wantNum);
    if (match) {
      try {
        const text = readFileSync(join(dataDir, match), 'utf-8');
        return { filename: match, fileText: text, chapterText: text };
      } catch {
        return null;
      }
    }
  }

  // Combined-manuscript book: anchor/apply on the whole file, show the segment.
  const combined = findCombinedManuscript(names);
  if (!combined) return null;
  let fileText: string;
  try {
    fileText = readFileSync(join(dataDir, combined), 'utf-8');
  } catch {
    return null;
  }
  const segments = splitManuscriptIntoChapters(fileText);
  // Match the segment by its slug name or by a parsed chapter number.
  const seg =
    segments.find((s) => s.name === chapterLabel) ??
    (wantNum >= 0 ? segments.find((s) => chapterNumberOf(s.name) === wantNum) : undefined);
  if (!seg) return null;
  return { filename: combined, fileText, chapterText: seg.text };
}
