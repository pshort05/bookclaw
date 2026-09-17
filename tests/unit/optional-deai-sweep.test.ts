/**
 * The de-AI sweep is optional when the writing directions already cover it.
 *
 * Evidence (Firefly Pond, 2026-09-15): across chapters 1-12 the sweep matched
 * ZERO entries from its own AI-tell list — because romance-*-first-draft/SKILL.md
 * already says "Avoid these AI tells (write around them from the first draft)"
 * and forbids adverbs, clichés, em-dashes and filter language. With nothing
 * on-task to do the pass instead line-edited: 4 injected passages of >=4 words
 * and 8 pronoun swaps, violating its own non-additive contract.
 *
 * So a pipeline whose draft skill carries the directions marks the sweep
 * `optional: true`, and it is skipped unless the book asks for it.
 *
 * THE TRAP THIS GUARDS: computeBoundaries fires the chapter/act gate on the
 * LAST step bearing a chapter number — which IS the sweep. Skip it naively and
 * every per-chapter and act gate silently stops firing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeBoundaries } from '../../gateway/src/services/pipeline/gate-cadence.js';
import { applyOptionalSteps } from '../../gateway/src/services/pipeline/optional-steps.js';
import { expandSteps } from '../../gateway/src/services/pipeline-expand.js';

const ROOT = join(import.meta.dirname, '..', '..');

/** One chapter of the deterministic romance shape. */
const chapter = (n: number, sweepStatus = 'pending') => ([
  { label: `Scene Brief — Chapter ${n}`, role: 'scene_brief', chapterNumber: n, status: 'completed' },
  { label: `First Draft — Chapter ${n}`, role: 'draft', chapterNumber: n, status: 'completed' },
  { label: `Improvement Plan — Chapter ${n}`, role: 'improve', chapterNumber: n, status: 'completed' },
  { label: `Rewrite — Chapter ${n}`, role: 'rewrite', chapterNumber: n, status: 'completed' },
  { label: `Consistency Audit — Chapter ${n}`, chapterNumber: n, status: 'completed' },
  { label: `Consistency Apply — Chapter ${n}`, chapterNumber: n, status: 'completed' },
  { label: `Humanize — De-AI Sweep — Chapter ${n}`, role: 'humanize', chapterNumber: n,
    status: sweepStatus, optional: true },
]);

// ── the gate must survive the skip ───────────────────────────────────────────
test('with the sweep skipped, the chapter gate moves to Consistency Apply', () => {
  const steps = chapter(3, 'skipped');
  const applyIdx = steps.findIndex((s) => s.label.startsWith('Consistency Apply'));
  assert.ok(computeBoundaries(applyIdx, steps).includes('chapter'),
    'Consistency Apply must become the chapter boundary once the sweep is skipped');
});

test('a skipped sweep does not itself raise a gate', () => {
  const steps = chapter(3, 'skipped');
  const sweepIdx = steps.length - 1;
  assert.deepEqual(computeBoundaries(sweepIdx, steps), [],
    'a skipped step must never be the boundary');
});

test('unchanged when the sweep runs — it is still the boundary', () => {
  const steps = chapter(3, 'pending');
  const sweepIdx = steps.length - 1;
  assert.ok(computeBoundaries(sweepIdx, steps).includes('chapter'));
  const applyIdx = steps.findIndex((s) => s.label.startsWith('Consistency Apply'));
  assert.deepEqual(computeBoundaries(applyIdx, steps), [],
    'Apply must NOT gate while the sweep still runs — that would double-gate the chapter');
});

test('the act boundary also moves with the skip', () => {
  // 3 chapters => act boundary at ceil(3/3) = chapter 1
  const steps = [...chapter(1, 'skipped'), ...chapter(2, 'skipped'), ...chapter(3, 'skipped')];
  const applyIdx = steps.findIndex((s) => s.label === 'Consistency Apply — Chapter 1');
  const b = computeBoundaries(applyIdx, steps);
  assert.ok(b.includes('chapter') && b.includes('act'), `expected chapter+act, got ${b}`);
});

// ── applying the book's setting ──────────────────────────────────────────────
test('optional steps are skipped by default (the directions already cover it)', () => {
  const project: any = { steps: chapter(1) };
  const n = applyOptionalSteps(project, undefined);
  assert.equal(n, 1);
  assert.equal(project.steps.at(-1).status, 'skipped');
});

test('deaiSweep:"run" keeps the sweep in the pipeline', () => {
  const project: any = { steps: chapter(1) };
  const n = applyOptionalSteps(project, { deaiSweep: 'run' });
  assert.equal(n, 0);
  assert.equal(project.steps.at(-1).status, 'pending');
});

test('switching to "run" restores a step skipped for this reason', () => {
  const project: any = { steps: chapter(1) };
  applyOptionalSteps(project, { deaiSweep: 'skip' });
  assert.equal(project.steps.at(-1).status, 'skipped');
  applyOptionalSteps(project, { deaiSweep: 'run' });
  assert.equal(project.steps.at(-1).status, 'pending', 'the author must be able to turn it back on');
});

test('never touches a step that already ran, is running, or failed', () => {
  for (const status of ['completed', 'active', 'failed']) {
    const project: any = { steps: chapter(1, status) };
    applyOptionalSteps(project, { deaiSweep: 'skip' });
    assert.equal(project.steps.at(-1).status, status, `${status} must be left alone`);
  }
});

test('never touches a mandatory step', () => {
  const steps = chapter(1);
  delete (steps.at(-1) as any).optional;
  const project: any = { steps };
  assert.equal(applyOptionalSteps(project, { deaiSweep: 'skip' }), 0);
  assert.equal(project.steps.at(-1).status, 'pending');
});

test('is idempotent', () => {
  const project: any = { steps: chapter(1) };
  assert.equal(applyOptionalSteps(project, undefined), 1);
  assert.equal(applyOptionalSteps(project, undefined), 0, 'second run must be a no-op');
});

// ── the flag survives expansion ──────────────────────────────────────────────
test('expandSteps carries `optional` onto every expanded chapter step', () => {
  const out = expandSteps([{
    expand: 'chapters',
    steps: [{ label: 'Humanize — De-AI Sweep — Chapter {{n}}', role: 'humanize',
              taskType: 'general', chapterNumber: '{{n}}', optional: true }],
  }] as any, { chapterCount: 3 } as any);
  assert.equal(out.length, 3);
  for (const s of out) assert.equal((s as any).optional, true, 'optional must survive expansion');
});

// ── the pipelines declare it where, and only where, it is true ───────────────
const CARRIES_DEAI = [
  'romance-spicy-deterministic', 'romance-spicy-full', 'romance-spicy',
  'romance-sweet-deterministic', 'romance-sweet-full', 'romance-sweet-full-legacy', 'romance-sweet',
];
const NEEDS_SWEEP = ['romantasy-production', 'technothriller-production', 'editorial-fingerprint'];

function sweepSteps(pipeline: string): any[] {
  const j = JSON.parse(readFileSync(join(ROOT, 'library', 'pipelines', `${pipeline}.json`), 'utf8'));
  const walk = (ss: any[]): any[] => ss.flatMap((s) => (s.expand ? walk(s.steps ?? []) : [s]));
  return walk(j.steps ?? []).filter((s) => /De-AI|Humanize/i.test(String(s.label ?? '')));
}

for (const p of CARRIES_DEAI) {
  test(`${p}: the sweep is optional (its draft skill already forbids the tells)`, () => {
    const steps = sweepSteps(p);
    assert.ok(steps.length > 0, `${p} has no sweep step`);
    for (const s of steps) assert.equal(s.optional, true, `${p} sweep must be marked optional`);
  });
}

for (const p of NEEDS_SWEEP) {
  test(`${p}: the sweep stays mandatory (its draft skill does NOT carry the directions)`, () => {
    for (const s of sweepSteps(p)) {
      assert.notEqual(s.optional, true, `${p} must keep its sweep — nothing upstream removes tells`);
    }
  });
}

// ── integration: the real pipeline, end to end ───────────────────────────────
test('romance-spicy-deterministic: the chapter gate survives the skip end-to-end', () => {
  const j = JSON.parse(readFileSync(join(ROOT, 'library', 'pipelines', 'romance-spicy-deterministic.json'), 'utf8'));
  const resolved = expandSteps(j.steps, { chapterCount: 3, wordsPerChapter: 1650 } as any);
  const project: any = {
    steps: resolved.map((s: any, i: number) => ({
      id: `p-step-${i + 1}`, label: s.label, role: s.role, skill: s.skill,
      chapterNumber: s.chapterNumber, status: 'pending',
      ...(s.optional ? { optional: true } : {}),
    })),
  };

  // 3 chapters x 7 steps: every sweep is marked optional and skipped by default.
  assert.equal(applyOptionalSteps(project, undefined), 3, 'one sweep per chapter');

  for (const n of [1, 2, 3]) {
    const sweep = project.steps.find((s: any) => s.role === 'humanize' && s.chapterNumber === n);
    assert.equal(sweep.status, 'skipped', `ch${n} sweep must be skipped`);

    const applyIdx = project.steps.findIndex(
      (s: any) => s.chapterNumber === n && /Consistency Apply/.test(s.label));
    const b = computeBoundaries(applyIdx, project.steps);
    assert.ok(b.includes('chapter'), `ch${n} must still raise a chapter boundary, got ${b}`);
  }

  // ceil(3/3)=1, ceil(6/3)=2, 3 -> every chapter is an act boundary at N=3
  const idx1 = project.steps.findIndex((s: any) => s.chapterNumber === 1 && /Consistency Apply/.test(s.label));
  assert.ok(computeBoundaries(idx1, project.steps).includes('act'), 'the act gate must survive too');

  // and turning it back on restores the sweep as the boundary
  assert.equal(applyOptionalSteps(project, { deaiSweep: 'run' }), 3);
  const sweepIdx = project.steps.findIndex((s: any) => s.role === 'humanize' && s.chapterNumber === 1);
  assert.ok(computeBoundaries(sweepIdx, project.steps).includes('chapter'));
});

test('a mandatory-sweep pipeline is untouched by the default', () => {
  const j = JSON.parse(readFileSync(join(ROOT, 'library', 'pipelines', 'romantasy-production.json'), 'utf8'));
  const resolved = expandSteps(j.steps, { chapterCount: 2, wordsPerChapter: 1650 } as any);
  const project: any = {
    steps: resolved.map((s: any, i: number) => ({
      id: `r-${i}`, label: s.label, role: s.role, chapterNumber: s.chapterNumber,
      status: 'pending', ...(s.optional ? { optional: true } : {}),
    })),
  };
  assert.equal(applyOptionalSteps(project, undefined), 0,
    'romantasy has no upstream de-AI directions — nothing may be skipped');
  assert.ok(project.steps.every((s: any) => s.status === 'pending'));
});

// ── the creation path actually stamps the flag onto a ProjectStep ────────────
test('createProjectFromPipeline carries `optional` onto the real ProjectStep', async () => {
  const { ProjectEngine } = await import('../../gateway/src/services/projects.js');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const root = mkdtempSync(join(tmpdir(), 'optional-steps-'));
  try {
    const engine: any = new ProjectEngine(undefined, root);
    const pipeline = JSON.parse(
      readFileSync(join(ROOT, 'library', 'pipelines', 'romance-spicy-deterministic.json'), 'utf8'));
    const project = engine.createProjectFromPipeline(
      pipeline, 'Optional Sweep Test', 'fixture',
      { targetChapters: 3, targetWordsPerChapter: 1650 });

    const sweeps = project.steps.filter((s: any) => s.role === 'humanize');
    assert.equal(sweeps.length, 3, 'one sweep per chapter');
    for (const s of sweeps) {
      assert.equal(s.optional, true, `${s.label} must carry optional onto the ProjectStep`);
    }
    assert.equal(project.steps.filter((s: any) => s.optional === true).length, 3,
      'no other step may be marked optional');

    // and the whole point: reconciling then skips exactly those three
    assert.equal(applyOptionalSteps(project, undefined), 3);
    assert.ok(sweeps.every((s: any) => s.status === 'skipped'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
