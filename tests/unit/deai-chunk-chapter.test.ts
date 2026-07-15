import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkChapter } from '../../gateway/src/services/deai/chunk-chapter.js';

const para = (n: number, w = 100) => `P${n} ` + Array.from({ length: w }, (_, i) => `w${i}`).join(' ');

test('short chapter (<1000 words) → single window, no seam', () => {
  const text = [para(1, 50), para(2, 50)].join('\n\n');
  const win = chunkChapter(text, 1000);
  assert.equal(win.length, 1);
  assert.equal(win[0].seam, '');
  assert.equal(win[0].text, text);
});

test('splits at paragraph boundaries around the target; never mid-paragraph', () => {
  const paras = Array.from({ length: 12 }, (_, i) => para(i + 1, 100)); // ~1200 words total
  const text = paras.join('\n\n');
  const win = chunkChapter(text, 500);
  assert.ok(win.length >= 2, 'multiple windows');
  // every window is a run of whole paragraphs (each starts with "P")
  for (const w of win) assert.match(w.text.trimStart(), /^P\d+/);
});

test('seam of window N is the last paragraph of window N-1', () => {
  const paras = Array.from({ length: 12 }, (_, i) => para(i + 1, 100));
  const win = chunkChapter(paras.join('\n\n'), 500);
  const prevLastPara = win[0].text.split(/\n\s*\n+/).filter(Boolean).pop();
  assert.equal(win[1].seam, prevLastPara);
});

test('scene break (---) forces a window boundary', () => {
  const text = [para(1, 100), '---', para(2, 100)].join('\n\n');
  const win = chunkChapter(text, 10000); // huge target: only the --- can split it
  assert.equal(win.length, 2);
});
