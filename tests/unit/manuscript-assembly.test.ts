/**
 * Deterministic manuscript assembly (run-review fix). The book-production
 * "compile" step emitted an LLM completion REPORT, not the novel; and the
 * revision "full manuscript rewrite" steps truncated to ~10% of the book. This
 * assembles the real chapters (latest polish>write, ordered, headings cleaned)
 * and validates the result didn't shrink/lose chapters.
 *
 * Run: node --import tsx --test tests/unit/manuscript-assembly.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseChapterFile,
  pickLatestChapters,
  normalizeChapter,
  assembleManuscript,
  validateAssembly,
} from '../../gateway/src/services/manuscript-assembly.js';

test('parseChapterFile extracts chapter number + kind, ignores non-chapter files', () => {
  assert.deepEqual(parseChapterFile('project-51-step-2-polish-chapter-1.md'), { number: 1, kind: 'polish' });
  assert.deepEqual(parseChapterFile('project-51-step-1-write-chapter-12.md'), { number: 12, kind: 'write' });
  assert.equal(parseChapterFile('project-51-step-65-compile-manuscript.md'), null);
  assert.equal(parseChapterFile('project-49-step-2-develop-premise.md'), null);
  // a title suffix after the number must still parse (label "Write Chapter 1: Title")
  assert.deepEqual(parseChapterFile('p-write-chapter-1-the-night-shift.md'), { number: 1, kind: 'write' });
  assert.deepEqual(parseChapterFile('p-polish-chapter-10-storm.md'), { number: 10, kind: 'polish' });
});

test('pickLatestChapters prefers polish over write, latest mtime as tiebreak, one per chapter', () => {
  const files = [
    { name: 'project-51-step-1-write-chapter-1.md', content: 'w1', mtime: 100 },
    { name: 'project-51-step-2-polish-chapter-1.md', content: 'p1', mtime: 200 },
    { name: 'project-51-step-3-write-chapter-2.md', content: 'w2', mtime: 150 },
    { name: 'foo-other.md', content: 'x', mtime: 999 },
  ];
  const picked = pickLatestChapters(files);
  assert.deepEqual(picked.map((f) => f.content), ['p1', 'w2']); // ch1 polish, ch2 write (no polish), ordered
});

test('pickLatestChapters: a newer write does NOT beat an existing polish (polish is canonical)', () => {
  const files = [
    { name: 'a-polish-chapter-1.md', content: 'polish', mtime: 100 },
    { name: 'b-write-chapter-1.md', content: 'write-newer', mtime: 500 },
  ];
  assert.deepEqual(pickLatestChapters(files).map((f) => f.content), ['polish']);
});

test('normalizeChapter strips the "# Polish/Write Chapter N" step header and leading rules', () => {
  const raw = '# Polish Chapter 1\n\n---\n\n## Chapter 1: The Night Shift\n\nThe rain fell.';
  assert.equal(normalizeChapter(raw), '## Chapter 1: The Night Shift\n\nThe rain fell.');
  // a chapter with no step header is unchanged (trimmed)
  assert.equal(normalizeChapter('## Chapter 2: X\n\nBody.'), '## Chapter 2: X\n\nBody.');
});

test('assembleManuscript builds one ordered markdown with a title header + chapter count/word count', () => {
  const files = [
    { name: 's-polish-chapter-2.md', content: '# Polish Chapter 2\n\n## Chapter 2: Two\n\nbeta gamma', mtime: 2 },
    { name: 's-polish-chapter-1.md', content: '# Polish Chapter 1\n\n## Chapter 1: One\n\nalpha', mtime: 1 },
  ];
  const r = assembleManuscript(files, { title: 'My Book', author: 'Jane' });
  assert.match(r.markdown, /^# My Book/);
  assert.ok(r.markdown.indexOf('## Chapter 1: One') < r.markdown.indexOf('## Chapter 2: Two'), 'chapters ordered');
  assert.ok(!r.markdown.includes('# Polish Chapter'), 'step headers stripped');
  assert.equal(r.chapterCount, 2);
  assert.equal(r.wordCount, 3); // alpha beta gamma
});

test('assembleManuscript returns empty/zero for no chapter files', () => {
  const r = assembleManuscript([{ name: 'compile-manuscript.md', content: 'report', mtime: 1 }], { title: 'X' });
  assert.equal(r.chapterCount, 0);
  assert.equal(r.wordCount, 0);
});

test('validateAssembly flags missing chapters and shrinkage', () => {
  const ok = { markdown: '...', chapterCount: 32, wordCount: 80000 };
  assert.equal(validateAssembly(ok, { expectedChapters: 32, minWords: 50000 }).ok, true);

  const missing = validateAssembly({ markdown: '', chapterCount: 22, wordCount: 8000 }, { expectedChapters: 32, minWords: 50000 });
  assert.equal(missing.ok, false);
  assert.ok(missing.problems.some((p) => /chapter/i.test(p)), 'flags missing chapters');
  assert.ok(missing.problems.some((p) => /word/i.test(p)), 'flags word shrink');

  // no expectations → only fails on zero content
  assert.equal(validateAssembly({ markdown: 'x', chapterCount: 5, wordCount: 5000 }, {}).ok, true);
  assert.equal(validateAssembly({ markdown: '', chapterCount: 0, wordCount: 0 }, {}).ok, false);
});
