/**
 * Unit test for the built-in romantasy-production pipeline (ported from the n8n
 * "Romantasy Book Writer" workflow). Asserts it is valid pipeline JSON and that
 * its expand:chapters block flattens into the faithful 5-stage-per-chapter chain
 * plus a compile step, with {{n}}/{{wordsPerChapter}} fully substituted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePipelineJson } from '../../gateway/src/services/book-types.js';
import { expandSteps } from '../../gateway/src/services/pipeline-expand.js';
import { buildPipelineVars } from '../../gateway/src/services/pipeline-vars.js';

const PIPELINE_PATH = join('library', 'pipelines', 'romantasy-production.json');

test('romantasy-production is valid pipeline JSON with a chapter-expand block', () => {
  const p = parsePipelineJson(readFileSync(PIPELINE_PATH, 'utf-8'));
  assert.equal(p.schemaVersion, 1);
  const expand = (p.steps as any[]).find((s) => s.expand === 'chapters');
  assert.ok(expand, 'has an expand:chapters group');
  assert.equal(expand.steps.length, 5, 'five per-chapter stages');
  assert.deepEqual(
    expand.steps.map((s: any) => s.taskType),
    ['outline', 'creative_writing', 'revision', 'revision', 'final_edit'],
    'stage task types match the Scene Brief -> Draft -> Critique -> Rewrite -> Humanize chain',
  );
});

test('expands to 5 steps per chapter plus a compile step, fully interpolated', () => {
  const p = parsePipelineJson(readFileSync(PIPELINE_PATH, 'utf-8'));
  const vars = buildPipelineVars({ title: 'Thunderwing', description: 'd', targetChapters: 4, targetWordsPerChapter: 2800 });
  const resolved = expandSteps(p.steps as any[], vars);

  assert.equal(resolved.length, 4 * 5 + 1, '4 chapters x 5 stages + compile');
  assert.ok(resolved.every((s) => !/\{\{/.test(s.prompt)), 'no unsubstituted {{vars}} remain');

  // Chapter numbers thread through every per-chapter stage.
  const ch3 = resolved.filter((s) => s.chapterNumber === 3);
  assert.equal(ch3.length, 5, 'chapter 3 has all five stages');

  // The prose stages carry the per-chapter word-count target.
  const draft = resolved.find((s) => s.label === 'First Draft — Chapter 1');
  assert.equal(draft?.wordCountTarget, 2800);
});
