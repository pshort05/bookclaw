/**
 * Human-Gate Cadence (Plan 5 code-review fix, C1): computeBoundaries must
 * detect boundaries in the SHIPPED library pipelines, not just synthetic
 * `phase: 'writing'|'outline'|'revision'` fixtures. Those synthetic fixtures
 * (tests/unit/gate-cadence.test.ts) masked a bug: romance-spicy.json /
 * romantasy-production.json use role/skill + chapterNumber, never a literal
 * `phase` of 'writing' or 'outline' — so the old phase-keyed computeBoundaries
 * returned [] for these pipelines and the cadence gate was a silent no-op.
 *
 * This test loads the REAL pipeline JSON via the same createProjectFromPipeline
 * path a live project uses (not a hand-built step array) and asserts the
 * chapter/act/pre_export/outline_approved boundaries actually fire.
 *
 * Run: node --import tsx --test tests/unit/gate-cadence-real-pipelines.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePipelineJson } from '../../gateway/src/services/book-types.js';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { computeBoundaries } from '../../gateway/src/services/pipeline/gate-cadence.js';

function loadPipeline(name: string) {
  const raw = readFileSync(join('library', 'pipelines', name), 'utf-8');
  return parsePipelineJson(raw);
}

function makeEngine(): ProjectEngine {
  const baseDir = mkdtempSync(join(tmpdir(), 'gate-cadence-real-'));
  return new ProjectEngine(undefined, baseDir);
}

test('romance-spicy.json: chapter/act/pre_export boundaries fire from role+chapterNumber, not phase', () => {
  const pipeline = loadPipeline('romance-spicy.json') as any;
  const engine = makeEngine();
  const project = engine.createProjectFromPipeline(
    pipeline, 'Test Romance', 'd', { targetChapters: 3, targetWordsPerChapter: 500 },
  );
  const steps = project.steps as any[];

  // 6 stages/chapter x 3 chapters + 1 compile step.
  assert.equal(steps.length, 19);

  // Sanity: these real steps carry role/chapterNumber, no 'writing'/'outline' phase.
  assert.equal(steps[0].phase, 'brief');
  assert.equal(steps[0].role, 'scene_brief');
  assert.equal(steps[0].chapterNumber, 1);

  // An ordinary (non-last, non-act) sub-step of chapter 1 is not a boundary.
  assert.deepEqual(computeBoundaries(0, steps), []); // Scene Brief — Chapter 1

  // Chapter 1's LAST stage (Intimacy, index 5) is the chapter boundary. With
  // targetChapters=3, every chapter also lands on a thirds-of-3 act boundary.
  assert.deepEqual(computeBoundaries(5, steps), ['chapter', 'act']);

  // Chapter 3's last stage (index 17) is simultaneously chapter/act/pre_export —
  // it's the step immediately before the compile (assembly) step at index 18.
  assert.equal(steps[17].label, 'Intimacy — Chapter 3');
  assert.equal(steps[18].phase, 'assembly');
  assert.deepEqual(computeBoundaries(17, steps), ['chapter', 'act', 'pre_export']);
});

test('book-planning.json: outline_approved fires on the LAST role=outline step, not phase', () => {
  const pipeline = loadPipeline('book-planning.json') as any;
  const engine = makeEngine();
  const project = engine.createProjectFromPipeline(pipeline, 'Test Book', 'd', {});
  const steps = project.steps as any[];

  // No step in book-planning.json carries a 'phase' field at all.
  assert.ok(steps.every((s) => s.phase === undefined));

  const outlineSteps = steps
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.role === 'outline' || s.skill === 'outline');
  assert.equal(outlineSteps.length, 2, 'Chapter-by-chapter outline + Synopsis generation both carry role=outline');

  const [firstOutline, lastOutline] = outlineSteps;
  assert.deepEqual(computeBoundaries(firstOutline.i, steps), [], 'first outline step is not the boundary');
  assert.deepEqual(computeBoundaries(lastOutline.i, steps), ['outline_approved']);
});
