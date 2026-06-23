import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KDPExporter } from '../../gateway/src/services/kdp-exporter.js';

const exporter = new KDPExporter();

test('disallowed tag (<script>) is stripped and warned; inner text is kept', () => {
  const r = exporter.exportBlurb('Hello <script>alert(1)</script> world');
  // The tag is removed but its text content survives — this strips tags, not script bodies.
  assert.equal(r.html, '<p>Hello alert(1) world</p>');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /Stripped disallowed tags: script/);
});

test('disallowed structural tag (<div>) is stripped and warned', () => {
  const r = exporter.exportBlurb('A <div>boxed</div> line');
  assert.equal(r.html, '<p>A boxed line</p>');
  assert.match(r.warnings[0], /Stripped disallowed tags: div/);
});

test('**bold** markdown becomes <b>', () => {
  const r = exporter.exportBlurb('This is **bold** text');
  assert.equal(r.html, '<p>This is <b>bold</b> text</p>');
  assert.equal(r.warnings.length, 0);
});

test('*italic* and _italic_ markdown become <i>', () => {
  const r = exporter.exportBlurb('An *emphatic* and _stressed_ word');
  assert.equal(r.html, '<p>An <i>emphatic</i> and <i>stressed</i> word</p>');
});

test('bullet list becomes <ul><li>; numbered list becomes <ol><li>', () => {
  const bullets = exporter.exportBlurb('Intro line\n\n- first\n- second');
  assert.equal(bullets.html, '<p>Intro line</p>\n<ul>\n<li>first</li>\n<li>second</li>\n</ul>');

  const numbered = exporter.exportBlurb('1. one\n2. two');
  assert.equal(numbered.html, '<ol>\n<li>one</li>\n<li>two</li>\n</ol>');
});

test('HTML over 4000 chars produces a length warning and reports the over-limit charCount', () => {
  const r = exporter.exportBlurb('x'.repeat(4100));
  // 4100 text chars wrapped in <p>…</p> => 4107.
  assert.equal(r.charCount, 4107);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /exceeds KDP's 4000-char limit/);
});

test('charCount tracks HTML length; plainCharCount tracks tag-free length', () => {
  const r = exporter.exportBlurb('Plain text here.');
  assert.equal(r.html, '<p>Plain text here.</p>');
  assert.equal(r.charCount, r.html.length);
  assert.equal(r.plainText, 'Plain text here.');
  assert.equal(r.plainCharCount, r.plainText.length);
});

test('preview shorter than 400 chars returns the first paragraph untouched (no ellipsis)', () => {
  const r = exporter.exportBlurb('Short and sweet.');
  assert.equal(r.preview, 'Short and sweet.');
  assert.equal(r.preview.includes('…'), false);
});

test('preview uses only the first paragraph of a multi-paragraph blurb', () => {
  const r = exporter.exportBlurb('Para one.\n\nPara two is different.');
  assert.equal(r.preview, 'Para one.');
  assert.equal(r.plainText, 'Para one.\n\nPara two is different.');
});

test('preview truncates at a sentence boundary when one lands past 60% of the 400-char limit', () => {
  // First sentence is 300 "A"s + "." (ends at char 301 > 240); second sentence is filler.
  const input = 'A'.repeat(300) + '. ' + 'B'.repeat(300) + '.';
  const r = exporter.exportBlurb(input);
  assert.equal(r.preview, 'A'.repeat(300) + '.');
  assert.equal(r.preview.includes('…'), false);
});

test('preview falls back to a word boundary with an ellipsis when no late sentence break exists', () => {
  const long = 'First sentence here. ' + 'word '.repeat(100) + 'tail.';
  const r = exporter.exportBlurb(long);
  assert.ok(r.preview.length <= 400);
  assert.ok(r.preview.endsWith('…'));
  // Word-boundary cut: the char before the ellipsis is not a partial word fragment space.
  assert.ok(!r.preview.endsWith(' …'));
});
