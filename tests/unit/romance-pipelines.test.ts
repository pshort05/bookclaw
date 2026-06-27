/**
 * Unit test for the built-in romance-sweet and romance-spicy pipelines (ported
 * from the n8n "Cross Lines" / "Romance Book Writer" workflows). Asserts each is
 * valid pipeline JSON and that its expand:chapters block flattens into the
 * faithful 6-stage-per-chapter chain (Scene Brief -> First Draft -> Improvement
 * Plan -> Rewrite -> Humanize -> Intimacy) plus a compile step, with
 * {{n}}/{{wordsPerChapter}} fully substituted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePipelineJson } from '../../gateway/src/services/book-types.js';
import { expandSteps } from '../../gateway/src/services/pipeline-expand.js';
import { buildPipelineVars } from '../../gateway/src/services/pipeline-vars.js';

const TASK_TYPES = ['outline', 'creative_writing', 'revision', 'revision', 'final_edit', 'creative_writing'];

for (const flavor of ['sweet', 'spicy'] as const) {
  const PIPELINE_PATH = join('library', 'pipelines', `romance-${flavor}.json`);

  test(`romance-${flavor} is valid pipeline JSON with a 6-stage chapter-expand block`, () => {
    const p = parsePipelineJson(readFileSync(PIPELINE_PATH, 'utf-8'));
    assert.equal(p.schemaVersion, 1);
    const expand = (p.steps as any[]).find((s) => s.expand === 'chapters');
    assert.ok(expand, 'has an expand:chapters group');
    assert.equal(expand.steps.length, 6, 'six per-chapter stages');
    assert.deepEqual(
      expand.steps.map((s: any) => s.taskType),
      TASK_TYPES,
      'stage task types match Scene Brief -> Draft -> Critique -> Rewrite -> Humanize -> Intimacy',
    );
  });

  test(`romance-${flavor} expands to 6 steps per chapter plus a compile step, fully interpolated`, () => {
    const p = parsePipelineJson(readFileSync(PIPELINE_PATH, 'utf-8'));
    const vars = buildPipelineVars({ title: 'Cross Lines', description: 'd', targetChapters: 4, targetWordsPerChapter: 2800 });
    const resolved = expandSteps(p.steps as any[], vars);

    assert.equal(resolved.length, 4 * 6 + 1, '4 chapters x 6 stages + compile');
    assert.ok(resolved.every((s) => !/\{\{/.test(s.prompt)), 'no unsubstituted {{vars}} remain');

    // Chapter numbers thread through every per-chapter stage.
    const ch3 = resolved.filter((s) => s.chapterNumber === 3);
    assert.equal(ch3.length, 6, 'chapter 3 has all six stages');

    // The prose stages (First Draft, Rewrite, Intimacy) carry the per-chapter word-count target.
    const draft = resolved.find((s) => s.label === 'First Draft — Chapter 1');
    assert.equal(draft?.wordCountTarget, 2800);
    const rewrite = resolved.find((s) => s.label === 'Rewrite — Chapter 1');
    assert.equal(rewrite?.wordCountTarget, 2800);
    const intimacy = resolved.find((s) => s.label === 'Intimacy — Chapter 1');
    assert.equal(intimacy?.wordCountTarget, 2800);
  });
}
