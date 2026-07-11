/**
 * TDD regression tests for VERIFIED Low bugs #30, #31, #33:
 *
 *  - #30: skipping the parked council-origination step must clear
 *    `project.selection` (via clearCouncilSelection) so /execute + /auto-execute
 *    don't 409 "Awaiting council base-story selection" forever. A normal skip
 *    (no pending selection) must be unaffected.
 *  - #31: applyCouncilSelection must reject an unknown candidateId (return
 *    false) instead of silently substituting the judge's recommendedId. A
 *    valid candidateId still completes normally.
 *  - #33a: the beat-math boundaries (setupEnd/incitingEnd/midpoint/twist75/
 *    climaxStart/climaxEnd) must be monotonically increasing and gap-free for
 *    realistic chapter counts, and degrade gracefully (no backward ranges)
 *    for tiny books.
 *  - #33b: chapter/polish/assembly prompts built via createPipeline's
 *    book-production phase must reference the clean book title, not the
 *    phase label ("X — Production").
 *
 * Run: node --import tsx --test tests/unit/beat-math-council-low.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { buildPipelineVars } from '../../gateway/src/services/pipeline-vars.js';

function engine(): ProjectEngine {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-beatmath-council-'));
  return new ProjectEngine(undefined, root);
}

const PIPELINE = { schemaVersion: 1, name: 'romance-sweet-full', label: 'P', description: 'd', dynamic: false, steps: [
  { label: 'Council — Base Story Origination', skill: 'council-origination', taskType: 'book_bible', phase: 'premise', promptTemplate: 'Council.' },
  { label: 'Premise', taskType: 'book_bible', phase: 'premise', promptTemplate: 'Premise.' },
] } as const;

function gatedProject() {
  const e = engine();
  e.setPipelineResolver(() => (PIPELINE as any));
  const p = e.createProjectResolved('book-planning' as any, 'P', 'd', {});
  e.startProject(p.id); // Council step active
  return { e, p };
}

const CANDIDATES = [
  { id: 'c1', model: 'claude', premise: 'Premise 1', relationshipArc: 'Arc 1', text: 'Text for c1' },
  { id: 'c2', model: 'gemini', premise: 'Premise 2', relationshipArc: 'Arc 2', text: 'Text for c2' },
];

function withSelection(p: any, recommendedId = 'c1') {
  p.selection = {
    stepId: p.steps[0].id,
    candidates: CANDIDATES,
    ranking: CANDIDATES.map((c, i) => ({ id: c.id, rank: i + 1, rationale: `why ${c.id}` })),
    recommendedId,
    rationale: 'overall rationale',
    createdAt: new Date().toISOString(),
  };
  p.status = 'paused';
}

// ── #30: skip must clear the parked council selection ───────────────────────

test('#30: skipping the parked council step clears project.selection (not wedged)', () => {
  const { e, p } = gatedProject();
  withSelection(p);
  const councilStepId = p.steps[0].id;

  const next = e.skipStep(p.id, councilStepId);

  const after = e.getProject(p.id)!;
  assert.equal((after as any).selection, undefined, 'selection must be cleared by the skip');
  assert.equal(after.steps[0].status, 'skipped');
  assert.ok(next, 'the next step becomes runnable');
  assert.equal(next!.id, after.steps[1].id);
  clearTimeout((e as any).saveDebounceTimer);
});

test('#30: a normal skip with no pending selection is unaffected', () => {
  const e = engine();
  const project = e.createProject('custom' as any, 'Normal Skip', 'desc');
  project.steps = [
    { id: 'a', label: 'Step A', taskType: 'general' as any, prompt: 'x', status: 'active' },
    { id: 'b', label: 'Step B', taskType: 'general' as any, prompt: 'x', status: 'pending' },
  ];
  project.status = 'active';

  const next = e.skipStep(project.id, 'a');

  const after = e.getProject(project.id)!;
  assert.equal((after as any).selection, undefined);
  assert.equal(after.steps[0].status, 'skipped');
  assert.ok(next);
  assert.equal(next!.id, 'b');
  clearTimeout((e as any).saveDebounceTimer);
});

// ── #31: applyCouncilSelection rejects an unknown candidateId ───────────────

test('#31: applyCouncilSelection returns false and leaves the project parked on an unknown candidateId', () => {
  const { e, p } = gatedProject();
  withSelection(p, 'c1');

  const result = (e as any).applyCouncilSelection(p.id, 'bogus-id');

  assert.equal(result, false, 'unknown candidateId must be signaled, not silently substituted');
  assert.equal(p.steps[0].status, 'active', 'step untouched');
  assert.ok((p as any).selection, 'selection left in place — nothing was silently applied');
  assert.equal(p.status, 'paused');
  clearTimeout((e as any).saveDebounceTimer);
});

test('#31: applyCouncilSelection still completes normally with a valid candidateId', () => {
  const { e, p } = gatedProject();
  withSelection(p, 'c1');

  const result = (e as any).applyCouncilSelection(p.id, 'c2');

  assert.equal(result, true);
  assert.equal(p.steps[0].status, 'completed');
  assert.equal(p.steps[0].result, 'Text for c2');
  assert.equal((p as any).selection, undefined, 'selection cleared');
  assert.equal(p.status, 'active');
  clearTimeout((e as any).saveDebounceTimer);
});

// ── #33a: beat math is monotonic and gap-free ────────────────────────────────

for (const chapterCount of [8, 25, 40]) {
  test(`#33a: beat boundaries are strictly increasing and gap-free for ${chapterCount} chapters`, () => {
    const v = buildPipelineVars({ title: 'T', description: 'd', targetChapters: chapterCount });
    assert.ok(v.setupEnd > 0, 'setupEnd must be positive');
    assert.ok(v.setupEnd < v.incitingEnd, 'setupEnd < incitingEnd');
    assert.ok(v.incitingEnd < v.midpoint, 'incitingEnd < midpoint');
    assert.ok(v.midpoint < v.twist75, 'midpoint < twist75');
    assert.ok(v.twist75 < v.climaxStart, 'twist75 < climaxStart');
    assert.ok(v.climaxStart <= v.climaxEnd, 'climaxStart <= climaxEnd');
    assert.ok(v.climaxEnd < chapterCount, 'climaxEnd leaves the final chapter for Resolution');
    assert.notEqual(v.midpoint, v.climaxStart, 'midpoint must not collide with climaxStart');

    // No gap: every chapter 1..chapterCount falls inside some beat range.
    for (let ch = 1; ch <= chapterCount; ch++) {
      const inSetup = ch <= v.setupEnd;
      const inInciting = ch > v.setupEnd && ch <= v.incitingEnd;
      const inRising = ch > v.incitingEnd && ch < v.midpoint;
      const isMidpoint = ch === v.midpoint;
      const inComplications = ch > v.midpoint && ch < v.twist75;
      const isTwist = ch === v.twist75;
      const inClimax = ch >= v.climaxStart && ch <= v.climaxEnd;
      const isResolution = ch === chapterCount;
      const covered = inSetup || inInciting || inRising || isMidpoint || inComplications || isTwist || inClimax || isResolution;
      assert.ok(covered, `chapter ${ch} of ${chapterCount} must fall in some beat range`);
    }
  });
}

test('#33a: the 25-chapter case assigns chapters 20-22 to the climax range (no more unassigned gap)', () => {
  const v = buildPipelineVars({ title: 'T', description: 'd', targetChapters: 25 });
  for (const ch of [20, 21, 22]) {
    assert.ok(ch >= v.climaxStart && ch <= v.climaxEnd, `chapter ${ch} must be inside climaxStart..climaxEnd (got ${v.climaxStart}-${v.climaxEnd})`);
  }
});

test('#33a: the 4-chapter case has no backwards range in the generated outline prompt', () => {
  const e = engine();
  const project = e.createNovelPipeline('Tiny Book', 'desc', { targetChapters: 4, targetWordsPerChapter: 500 });
  const outlineStep = project.steps.find(s => s.label === 'Chapter outline')!;
  assert.ok(outlineStep, 'outline step must exist');
  const ranges = [...outlineStep.prompt.matchAll(/Chapters (\d+)-(\d+)/g)];
  assert.ok(ranges.length > 0, 'the prompt must contain at least one Chapters X-Y range');
  for (const [, start, end] of ranges) {
    assert.ok(Number(start) <= Number(end), `range "${start}-${end}" must not be backwards`);
  }
  clearTimeout((e as any).saveDebounceTimer);
});

// ── #33b: chapter prompts use the clean book title, not the phase label ─────

test('#33b: book-production chapter prompts built via createPipeline use the clean title, not "Title — Production"', () => {
  const e = engine();
  e.setPipelineResolver(() => null); // static phases fall back to createProject; only book-production matters here
  const { projects } = e.createPipeline('MyBook', 'A description', undefined, { targetChapters: 1, targetWordsPerChapter: 300 });

  const production = projects.find(p => p.type === 'book-production')!;
  assert.ok(production, 'book-production sub-project must exist');
  assert.equal(production.title, 'MyBook — Production', 'the project label itself is unchanged');

  const chapterStep = production.steps.find(s => s.phase === 'writing')!;
  assert.ok(chapterStep, 'chapter-writing step must exist');
  assert.match(chapterStep.prompt, /Write Chapter 1 of "MyBook"/, 'chapter prompt must reference the clean title');
  assert.doesNotMatch(chapterStep.prompt, /MyBook — Production/, 'chapter prompt must not leak the phase label');

  const polishStep = production.steps.find(s => s.phase === 'polish')!;
  assert.ok(polishStep);
  assert.doesNotMatch(polishStep.prompt, /MyBook — Production/, 'polish prompt must not leak the phase label');

  clearTimeout((e as any).saveDebounceTimer);
});
