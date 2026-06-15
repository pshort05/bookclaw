import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPipelineVars } from '../../gateway/src/services/pipeline-vars.ts';
import { expandSteps } from '../../gateway/src/services/pipeline-expand.ts';

test('buildPipelineVars computes chapter count, words, and structural beats', () => {
  const v = buildPipelineVars({ title: 'T', description: 'D', targetChapters: 20, targetWordsPerChapter: 2500 });
  assert.equal(v.chapterCount, 20);
  assert.equal(v.wordsPerChapter, 2500);
  assert.equal(v.midpoint, 10);      // round(20*0.5)
  assert.equal(v.twist75, 15);       // round(20*0.75)
  assert.equal(v.climaxStart, 18);   // chapters-2
});
test('buildPipelineVars applies defaults and clamps', () => {
  const v = buildPipelineVars({ title: 'T', description: 'D' });
  assert.equal(v.chapterCount, 25);
  assert.equal(v.wordsPerChapter, 3000);
  const c = buildPipelineVars({ title: 'T', description: 'D', targetChapters: 999 });
  assert.equal(c.chapterCount, 200); // clamp
});

test('expandSteps flattens a chapter group interleaved with interpolated vars', () => {
  const vars = buildPipelineVars({ title: 'Book', description: 'D', targetChapters: 2, targetWordsPerChapter: 1500 });
  const raw = [
    { expand: 'chapters', steps: [
      { label: 'Write Chapter {{n}}', skill: 'write', taskType: 'creative_writing', phase: 'writing', wordCountTarget: '{{wordsPerChapter}}', chapterNumber: '{{n}}', promptTemplate: 'Write Chapter {{n}} of "{{title}}" ({{wordsPerChapter}} words).' },
      { label: 'Polish Chapter {{n}}', skill: 'revise', taskType: 'revision', phase: 'polish', chapterNumber: '{{n}}', promptTemplate: 'Polish Chapter {{n}}.' },
    ] },
    { label: 'Compile', taskType: 'general', phase: 'assembly', promptTemplate: 'Compile {{chapterCount}} chapters.' },
  ];
  const out = expandSteps(raw, vars);
  assert.equal(out.length, 5); // 2*2 + 1, interleaved
  assert.deepEqual(out.map((s) => s.label), ['Write Chapter 1', 'Polish Chapter 1', 'Write Chapter 2', 'Polish Chapter 2', 'Compile']);
  assert.equal(out[0].chapterNumber, 1);
  assert.equal(out[0].wordCountTarget, 1500);
  assert.equal(out[0].prompt, 'Write Chapter 1 of "Book" (1500 words).');
  assert.equal(out[4].prompt, 'Compile 2 chapters.');
});

test('a malformed expand group is skipped, not emitted as a junk empty step', () => {
  const vars = buildPipelineVars({ title: 'T', description: 'D', targetChapters: 2 });
  const raw = [
    { expand: 'chapters' },                                  // missing steps[]
    { expand: 'pages', steps: [{ label: 'x', taskType: 'general', promptTemplate: 'y' }] }, // unknown kind
    { label: 'Real', taskType: 'general', promptTemplate: 'ok' },
  ];
  const out = expandSteps(raw as any, vars);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, 'Real');
});

test('book-production.json expands to interleaved chapters + compile', () => {
  const pipe = JSON.parse(readFileSync(new URL('../../library/pipelines/book-production.json', import.meta.url), 'utf8'));
  const vars = buildPipelineVars({ title: 'X', description: 'Y', targetChapters: 3 });
  const out = expandSteps(pipe.steps, vars);
  assert.equal(out.length, 3 * 2 + 1);
  assert.equal(out[out.length - 1].phase, 'assembly');
  assert.ok(out[0].prompt.includes('Chapter 1'));
});
