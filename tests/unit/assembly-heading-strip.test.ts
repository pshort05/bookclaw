/**
 * FINDING 4: `normalizeChapter` stripped only "Polish|Write Chapter N" step
 * headers, so compiled chapters from the widened chapter classifier (which now
 * admits first-draft/rewrite/consistency-apply/humanize and more) opened with a
 * literal step-label heading, e.g. "# Consistency Apply — Chapter 7". Every
 * chapter step's output file is written as `# ${step.label}\n\n${result}` and
 * every recognised chapter label ends in "Chapter N" (see
 * gateway/src/services/pipeline/chapter-files.ts + library/pipelines/*.json) —
 * so the fix strips any leading "<prefix> Chapter N" heading, not an
 * enumerated list of role words.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChapter } from '../../gateway/src/services/manuscript-assembly.js';

test('normalizeChapter strips the injected step-label heading for every prose role', () => {
  const cases: Array<[string, string]> = [
    ['# Write Chapter 5\n\nThe rain fell.', 'The rain fell.'],
    ['# Polish Chapter 5\n\nThe rain fell.', 'The rain fell.'],
    ['# First Draft — Chapter 3\n\nThe rain fell.', 'The rain fell.'],
    ['# Rewrite — Chapter 7\n\nThe rain fell.', 'The rain fell.'],
    ['# Consistency Apply — Chapter 7\n\nThe rain fell.', 'The rain fell.'],
    ['# Humanize — De-AI Sweep — Chapter 12\n\nThe rain fell.', 'The rain fell.'],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(normalizeChapter(raw), expected, `failed for: ${raw.split('\n')[0]}`);
  }
});

test('normalizeChapter preserves a genuine titled chapter heading', () => {
  const raw = '## Chapter 12 — "Title"\n\nThe rain fell.';
  assert.equal(normalizeChapter(raw), raw);
});

test('normalizeChapter preserves a bare untitled chapter heading (no step-label prefix)', () => {
  const raw = '# Chapter 3\n\nThe rain fell.';
  assert.equal(normalizeChapter(raw), raw);
});

test('normalizeChapter preserves a titled heading that happens to start with a role word', () => {
  const raw = '## Write Chapter 5: The Reckoning\n\nThe rain fell.';
  assert.equal(normalizeChapter(raw), raw);
});
