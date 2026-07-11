/**
 * Regression tests for VERIFIED Low bug #34 (assembly/export polish, 5 sub-parts):
 *
 * (a) The manuscript title block ("# Title\n\n*by Author*", prepended by
 *     assembleManuscript) was parsed as a bogus first "chapter" by both
 *     exporters' `^#{1,2}\s` chapter-splitters — a phantom heading in the DOCX
 *     body, and the first EPUB nav TOC entry — duplicating the dedicated
 *     front-matter title page each builder makes separately.
 * (b) A plain markdown horizontal rule ("---") was converted into a "* * *"
 *     scene break by both exporters, even when not intended as one.
 * (c) "####"+ headings and blockquote ">" lines fell through to the plain
 *     paragraph branch, rendering literal "####"/">" marks in the output.
 * (d) Any two single asterisks on a line (e.g. "3 * 4 * 5") were paired and
 *     italicized, even when clearly not intended as emphasis.
 * (e) The deep-revision pipeline's "Apply ... revisions (full manuscript
 *     rewrite)" steps save the ENTIRE rewritten manuscript under a step-label
 *     filename that manuscript-assembly didn't recognize, so the rewrite was
 *     silently dropped in favor of the older polish-chapter-N.md.
 *
 * Run: node --import tsx --test tests/unit/export-polish.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import {
  generateDocxBuffer, parseMarkdownToDocx, parseInlineFormatting, stripLeadingTitleBlock,
} from '../../gateway/src/services/docx-export.js';
import {
  generateEpubBuffer, splitIntoChapters, markdownToXhtml,
} from '../../gateway/src/services/epub-export.js';
import { extractDocxText } from '../../gateway/src/services/docx-extract.js';
import { pickLatestChapters } from '../../gateway/src/services/manuscript-assembly.js';

// ─────────────────────────────────────────────────────────────────────────────
// (a) Phantom title chapter
// ─────────────────────────────────────────────────────────────────────────────

test('(a) DOCX: stripLeadingTitleBlock drops the title/byline block up to the next heading', () => {
  const content = '# My Book\n\n*by Jane*\n\n## Chapter 1: Start\n\nThe story begins.';
  assert.equal(stripLeadingTitleBlock(content, 'My Book'), '## Chapter 1: Start\n\nThe story begins.');
});

test('(a) DOCX: a heading that does not match the book title is left alone', () => {
  const content = '## Chapter 1: Start\n\nThe story begins.';
  assert.equal(stripLeadingTitleBlock(content, 'My Book'), content);
});

test('(a) DOCX: title-page text appears exactly once in the generated document; no phantom chapter body text', async () => {
  const content = '# My Book\n\n*by Jane*\n\n## Chapter 1: Start\n\nThe story begins.';
  const buffer = await generateDocxBuffer({ title: 'My Book', author: 'Jane', content });
  const text = extractDocxText(buffer);
  assert.equal((text.match(/MY BOOK/g) || []).length, 1, 'title page appears exactly once');
  assert.ok(!text.includes('by Jane'), 'byline block dropped from the body');
  assert.ok(text.includes('CHAPTER 1: START'), 'real chapter 1 heading present');
  assert.ok(text.indexOf('CHAPTER 1: START') < text.indexOf('The story begins.'));
});

test('(a) EPUB: splitIntoChapters excludes the title block; first chapter is real Chapter 1', () => {
  const content = '# My Book\n\n*by Jane*\n\n## Chapter 1: Start\n\nThe story begins.\n\n## Chapter 2: Next\n\nMore.';
  const chapters = splitIntoChapters(content, 'My Book');
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].title, 'Chapter 1: Start');
  assert.equal(chapters[1].title, 'Chapter 2: Next');
});

test('(a) EPUB: nav TOC first entry is Chapter 1, not the book title', async () => {
  const content = '# My Book\n\n*by Jane*\n\n## Chapter 1: Start\n\nThe story begins.';
  const buffer = await generateEpubBuffer({ title: 'My Book', author: 'Jane', content });
  const zip = new AdmZip(buffer);
  const nav = zip.getEntry('OEBPS/nav.xhtml')!.getData().toString('utf-8');
  const firstLi = nav.match(/<li>.*?<\/li>/)![0];
  assert.match(firstLi, /Chapter 1: Start/);
  assert.ok(!firstLi.includes('My Book'));
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Spurious "---" scene breaks
// ─────────────────────────────────────────────────────────────────────────────

test('(b) DOCX/EPUB: a lone "---" is NOT converted into a scene break', () => {
  const md = 'Paragraph one.\n\n---\n\nParagraph two.';
  const html = markdownToXhtml(md);
  assert.ok(!html.includes('scene-break'), 'epub: no scene-break class emitted for a stray ---');

  const paras = parseMarkdownToDocx(md);
  // None of the generated paragraphs should render the "* * *" scene-break glyph.
  const hasSceneBreak = paras.some((p: any) =>
    JSON.stringify(p).includes('* * *'));
  assert.equal(hasSceneBreak, false);
});

test('(b) DOCX/EPUB: real "***" and "* * *" scene breaks still work', () => {
  const html1 = markdownToXhtml('***');
  assert.ok(html1.includes('scene-break'));
  const html2 = markdownToXhtml('* * *');
  assert.ok(html2.includes('scene-break'));

  const paras = parseMarkdownToDocx('***');
  assert.ok(paras.some((p: any) => JSON.stringify(p).includes('* * *')));
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) #### headings and blockquotes
// ─────────────────────────────────────────────────────────────────────────────

test('(c) EPUB: "#### Sub-sub" renders as a heading, not literal hashes', () => {
  const html = markdownToXhtml('#### Sub-sub');
  assert.ok(!html.includes('####'));
  assert.match(html, /<h4>Sub-sub<\/h4>/);
});

test('(c) EPUB: "> quote" renders without a literal leading ">"', () => {
  const html = markdownToXhtml('> quote');
  assert.match(html, /quote/);
  assert.ok(!html.trimStart().startsWith('<p>&gt;'), 'blockquote marker not rendered as literal text');
});

test('(c) DOCX: "#### Sub-sub" and "> quote" do not render literal "####"/">"', () => {
  const paras = parseMarkdownToDocx('#### Sub-sub\n\n> quote');
  const dump = JSON.stringify(paras);
  assert.ok(!dump.includes('####'));
  assert.ok(dump.includes('Sub-sub'));
  assert.ok(dump.includes('quote'));
  // The blockquote paragraph's text must not still carry a leading "> ".
  assert.ok(!dump.includes('> quote'));
});

// ─────────────────────────────────────────────────────────────────────────────
// (d) Stray asterisk pairs
// ─────────────────────────────────────────────────────────────────────────────

test('(d) EPUB: "3 * 4 * 5" is NOT italicized', () => {
  const html = markdownToXhtml('3 * 4 * 5');
  assert.ok(!html.includes('<em>'));
  assert.match(html, /3 \* 4 \* 5/);
});

test('(d) EPUB: "*word*" IS italicized', () => {
  const html = markdownToXhtml('*word*');
  assert.match(html, /<em>word<\/em>/);
});

// docx's TextRun serializes italics as an OOXML "w:i" run-property element
// (there is no literal "italics" key in the built object), so assert on that.
test('(d) DOCX: "3 * 4 * 5" is NOT italicized', () => {
  const runs = parseInlineFormatting('3 * 4 * 5');
  const dump = JSON.stringify(runs);
  assert.ok(!dump.includes('"rootKey":"w:i"'), 'no italic run-property emitted');
  assert.ok(dump.includes('3 * 4 * 5'), 'text preserved literally');
});

test('(d) DOCX: "*word*" IS italicized', () => {
  const runs = parseInlineFormatting('*word*');
  const dump = JSON.stringify(runs);
  assert.ok(dump.includes('"rootKey":"w:i"'), 'italic run-property emitted');
  assert.ok(dump.includes('word') && !dump.includes('*word*'), 'asterisks stripped from the run text');
});

// ─────────────────────────────────────────────────────────────────────────────
// (e) Revision-rewrite supersedes write/polish
// ─────────────────────────────────────────────────────────────────────────────

test('(e) a whole-manuscript revision-rewrite file supersedes the older polish-chapter-N for chapters it covers', () => {
  const files = [
    { name: 'p-write-chapter-1.md', content: '## Chapter 1: One\n\nOld write.', mtime: 100 },
    { name: 'p-polish-chapter-1.md', content: '## Chapter 1: One\n\nOld polish.', mtime: 200 },
    { name: 'p-polish-chapter-2.md', content: '## Chapter 2: Two\n\nOld polish two.', mtime: 200 },
    {
      name: 'project-9-step-24-apply-line-level-revisions-full-manuscript-rewrite-.md',
      content: '## Chapter 1: One\n\nRevised prose one.\n\n## Chapter 2: Two\n\nRevised prose two.',
      mtime: 300,
    },
  ];
  const picked = pickLatestChapters(files);
  assert.equal(picked.length, 2);
  assert.match(picked[0].content, /Revised prose one/);
  assert.doesNotMatch(picked[0].content, /Old polish/);
  assert.match(picked[1].content, /Revised prose two/);
});

test('(e) a chapter NOT covered by the revision rewrite keeps its write/polish pick', () => {
  const files = [
    { name: 'p-polish-chapter-1.md', content: '## Chapter 1: One\n\nOld polish one.', mtime: 200 },
    { name: 'p-polish-chapter-2.md', content: '## Chapter 2: Two\n\nOld polish two.', mtime: 200 },
    {
      name: 'project-9-step-22-apply-macro-revisions-full-manuscript-rewrite-.md',
      content: '## Chapter 1: One\n\nRevised prose one.',
      mtime: 300,
    },
  ];
  const picked = pickLatestChapters(files);
  assert.equal(picked.length, 2);
  assert.match(picked[0].content, /Revised prose one/);
  assert.match(picked[1].content, /Old polish two/);
});

test('(e) the newest of multiple revision-rewrite files wins (macro < scene-level < line-level)', () => {
  const files = [
    {
      name: 'project-9-step-22-apply-macro-revisions-full-manuscript-rewrite-.md',
      content: '## Chapter 1: One\n\nMacro pass.',
      mtime: 100,
    },
    {
      name: 'project-9-step-24-apply-line-level-revisions-full-manuscript-rewrite-.md',
      content: '## Chapter 1: One\n\nLine-level pass.',
      mtime: 300,
    },
  ];
  const picked = pickLatestChapters(files);
  assert.equal(picked.length, 1);
  assert.match(picked[0].content, /Line-level pass/);
});
