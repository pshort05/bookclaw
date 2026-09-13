/**
 * Regression: the outline step must be told the author's word target.
 *
 * Firefly Pond (2026-09-13) was created with 25 chapters x 2,400 words. The
 * manifest, the project context and all 25 draft steps stored that correctly —
 * but the generated outline came back "25 chapters · ~90,000 words" with
 * per-chapter targets of 3,200, because the outline promptTemplate interpolated
 * {{chapterCount}} and NO word figure, while the same prompt told the model to
 * treat as canon a blueprint that stated "24-28 chapters (based on
 * 80,000-90,000 words)". The model honoured the only number it was given and
 * took the word budget from the only source that stated one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { interpolate } from '../../gateway/src/services/pipeline-expand.js';
import { computeBeats } from '../../gateway/src/services/pipeline-vars.js';

const ROOT = join(import.meta.dirname, '..', '..');

/** Every pipeline whose outline step WRITES the outline from scratch. */
const OUTLINE_WRITERS = [
  'romance-spicy-deterministic',
  'romance-spicy-full',
  'romance-sweet-deterministic',
  'romance-sweet-full',
  'romance-sweet-full-legacy',
  'book-planning',
];

function outlineStep(pipeline: string): { label: string; promptTemplate: string } {
  const j = JSON.parse(readFileSync(join(ROOT, 'library', 'pipelines', `${pipeline}.json`), 'utf8'));
  const step = (j.steps ?? []).find((s: any) => /outline/i.test(String(s.label ?? '')));
  assert.ok(step, `${pipeline} has no outline step`);
  return step;
}

function render(pipeline: string, chapterCount: number, wordsPerChapter: number): string {
  const step = outlineStep(pipeline);
  return interpolate(step.promptTemplate, {
    title: 'Firefly Pond',
    description: 'a premise',
    chapterCount,
    wordsPerChapter,
    ...computeBeats(chapterCount),
    blueprint: '## Chapter Count & Pacing\n**Estimated chapter count:** 24-28 chapters (based on 80,000-90,000 words)',
  } as Record<string, string | number>);
}

for (const pipeline of OUTLINE_WRITERS) {
  test(`${pipeline}: the outline prompt states the author's word target`, () => {
    const prompt = render(pipeline, 25, 2400);
    assert.match(prompt, /2400/, 'the per-chapter word target must reach the outline prompt');
    assert.match(prompt, /25/, 'the chapter count must still reach the outline prompt');
  });

  test(`${pipeline}: the author's settings are declared to beat the blueprint's budget`, () => {
    const prompt = render(pipeline, 25, 2400);
    // The prompt tells the model the blueprint is canon; without an explicit
    // precedence rule a blueprint stating its own word budget wins.
    assert.match(prompt, /OVERRIDE/i, 'the prompt must say the settings override the blueprint');
  });

  test(`${pipeline}: the outline prompt leaves no unreplaced placeholders`, () => {
    const prompt = render(pipeline, 25, 2400);
    assert.equal(prompt.match(/\{\{\s*\w+\s*\}\}/g), null, `unreplaced placeholders in ${pipeline}`);
  });
}

test('the word target tracks the book, not a hardcoded default', () => {
  const a = render('romance-sweet-deterministic', 30, 1800);
  assert.match(a, /1800/);
  assert.match(a, /30 chapters/);
  assert.doesNotMatch(a, /2400/, 'the previous test\'s numbers must not be baked into the template');
});
