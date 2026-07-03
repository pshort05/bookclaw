/**
 * Human-Gate Cadence (Flagship Plan 5, Task 4): `maybeOpenCadenceGate` wired
 * against a REAL ProjectEngine driving a REAL multi-chapter pipeline — proves
 * a per_act book pauses only at act boundaries and a per_chapter book pauses
 * every chapter, using the actual computeBoundaries/resolveCadence/shouldGate
 * + openReviewGate/applyReviewResume machinery (not a permissive stub). The
 * fake ConfirmationGate FAILS like production would if createRequest is
 * called with the wrong shape (mirrors tests/unit/beta-reader-gate-seam.test.ts's
 * "fails like production" convention), so a mis-wired call surfaces here.
 *
 * Run: node --import tsx --test tests/unit/gate-wiring.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { maybeOpenCadenceGate } from '../../gateway/src/services/human-review.js';

// A 9-chapter production pipeline — act boundaries land on chapters 3, 6, 9
// (see gate-cadence.test.ts's isActBoundary table).
function ninChapterPipeline() {
  return {
    schemaVersion: 1, name: 'book-production', label: 'Production', description: 'd', dynamic: false,
    steps: Array.from({ length: 9 }, (_, i) => ({
      label: `Write Chapter ${i + 1}`, skill: 'write', taskType: 'creative_writing',
      phase: 'writing', chapterNumber: i + 1, promptTemplate: 'Write.',
    })),
  } as const;
}

function realEngine() {
  const e = new ProjectEngine(undefined, mkdtempSync(join(tmpdir(), 'bookclaw-gatewiring-')));
  e.setPipelineResolver(() => (ninChapterPipeline() as any));
  return e;
}

/** Fails like production: createRequest throws on a malformed input, exactly
 *  like ConfirmationGateService would reject a bad payload shape. */
function strictGate() {
  const created: any[] = [];
  return {
    created,
    async createRequest(input: any) {
      if (!input?.service || !input?.action || !input?.payload?.projectId || !input?.payload?.stepId) {
        throw new Error('malformed confirmation request — missing required fields');
      }
      created.push(input);
      return { id: `conf-${created.length}` };
    },
    checkDecision() { return { status: 'pending', request: null }; },
    async recordOutcome() { return null; },
  };
}

/**
 * Drives the pipeline exactly the way projects.routes.ts's /auto-execute loop
 * does: generate (fake) content for the active step, call maybeOpenCadenceGate
 * BEFORE completeStep, and stop the moment a gate opens.
 */
async function driveUntilGateOrDone(
  e: ProjectEngine, gate: ReturnType<typeof strictGate>, projectId: string,
  ctx: { manifest?: any; headless?: boolean } = {},
): Promise<{ gatedAtChapter: number | null; chaptersCompleted: number[] }> {
  const chaptersCompleted: number[] = [];
  for (let i = 0; i < 20; i++) {
    const project = e.getProject(projectId)!;
    if (project.status !== 'active') break;
    const activeStep = project.steps.find((s: any) => s.status === 'active');
    if (!activeStep) break;

    const response = `Prose for chapter ${activeStep.chapterNumber}.`;
    const result = await maybeOpenCadenceGate({ gate, engine: e as any }, project, activeStep, response, ctx);
    if (result.gated) return { gatedAtChapter: activeStep.chapterNumber ?? null, chaptersCompleted };

    e.completeStep(projectId, activeStep.id, response);
    chaptersCompleted.push(activeStep.chapterNumber as number);
  }
  return { gatedAtChapter: null, chaptersCompleted };
}

test('a per_act book pauses at the FIRST act boundary (chapter 3 of 9), not before', async () => {
  const e = realEngine();
  const p = e.createProjectResolved('book-production' as any, 'P', 'd', {});
  e.startProject(p.id);
  const gate = strictGate();
  const manifest = { review: { cadence: 'per_act' } };

  const outcome = await driveUntilGateOrDone(e, gate, p.id, { manifest });

  assert.deepEqual(outcome.chaptersCompleted, [1, 2], 'chapters 1-2 complete without gating');
  assert.equal(outcome.gatedAtChapter, 3, 'gated exactly on the act-ending chapter');
  assert.equal(gate.created.length, 1);
  assert.equal(gate.created[0].payload.kind, 'cadence-gate');
  const project = e.getProject(p.id)!;
  assert.equal(project.status, 'paused');
  assert.equal((project as any).review?.kind, 'cadence-gate');
  assert.equal((project as any).review?.pendingResult, 'Prose for chapter 3.', 'real drafted text stashed for resume');
  clearTimeout((e as any).saveDebounceTimer);
});

test('a per_act book, once resumed, runs to the NEXT act boundary (chapter 6) — not per chapter', async () => {
  const e = realEngine();
  const p = e.createProjectResolved('book-production' as any, 'P', 'd', {});
  e.startProject(p.id);
  const gate = strictGate();
  const manifest = { review: { cadence: 'per_act' } };

  const first = await driveUntilGateOrDone(e, gate, p.id, { manifest });
  assert.equal(first.gatedAtChapter, 3);

  // Approve: resume with the real pendingResult, mirroring the /review/action endpoint.
  const project = e.getProject(p.id)!;
  (e as any).applyReviewResume(p.id, (project as any).review.stepId, 'cadence-gate', 'approve');

  const second = await driveUntilGateOrDone(e, gate, p.id, { manifest });
  assert.deepEqual(second.chaptersCompleted, [4, 5], 'chapters 4-5 complete without gating');
  assert.equal(second.gatedAtChapter, 6, 'gated on the SECOND act-ending chapter, not every chapter');
  clearTimeout((e as any).saveDebounceTimer);
});

test('a per_chapter book gates on EVERY chapter, including act-ending ones', async () => {
  const e = realEngine();
  const p = e.createProjectResolved('book-production' as any, 'P', 'd', {});
  e.startProject(p.id);
  const gate = strictGate();
  const manifest = { review: { cadence: 'per_chapter' } };

  const first = await driveUntilGateOrDone(e, gate, p.id, { manifest });
  assert.deepEqual(first.chaptersCompleted, [], 'gates before even chapter 1 completes');
  assert.equal(first.gatedAtChapter, 1);

  const project = e.getProject(p.id)!;
  (e as any).applyReviewResume(p.id, (project as any).review.stepId, 'cadence-gate', 'approve');
  const second = await driveUntilGateOrDone(e, gate, p.id, { manifest });
  assert.deepEqual(second.chaptersCompleted, [], 'chapter 2 gates immediately too — no run of un-gated chapters');
  assert.equal(second.gatedAtChapter, 2);
  clearTimeout((e as any).saveDebounceTimer);
});

test('an autonomous book never gates on chapter/act boundaries at all', async () => {
  const e = realEngine();
  const p = e.createProjectResolved('book-production' as any, 'P', 'd', {});
  e.startProject(p.id);
  const gate = strictGate();
  const manifest = { review: { cadence: 'autonomous' } };

  const outcome = await driveUntilGateOrDone(e, gate, p.id, { manifest });

  assert.deepEqual(outcome.chaptersCompleted, [1, 2, 3, 4, 5, 6, 7, 8, 9], 'ran the whole book with no chapter/act gate');
  assert.equal(outcome.gatedAtChapter, null);
  assert.equal(gate.created.length, 0);
  clearTimeout((e as any).saveDebounceTimer);
});

test('no book manifest defaults to per_act (backward compatible with today\'s behavior)', async () => {
  const e = realEngine();
  const p = e.createProjectResolved('book-production' as any, 'P', 'd', {});
  e.startProject(p.id);
  const gate = strictGate();

  const outcome = await driveUntilGateOrDone(e, gate, p.id, {}); // no manifest at all

  assert.equal(outcome.gatedAtChapter, 3, 'defaults to per_act cadence');
  clearTimeout((e as any).saveDebounceTimer);
});

test('headless=true never gates, regardless of cadence (avoids stalling headless/autonomous runs)', async () => {
  const e = realEngine();
  const p = e.createProjectResolved('book-production' as any, 'P', 'd', {});
  e.startProject(p.id);
  const gate = strictGate();
  const manifest = { review: { cadence: 'per_chapter' } }; // would gate on every chapter if interactive

  const outcome = await driveUntilGateOrDone(e, gate, p.id, { manifest, headless: true });

  assert.deepEqual(outcome.chaptersCompleted, [1, 2, 3, 4, 5, 6, 7, 8, 9], 'headless run completes the whole book with no gate');
  assert.equal(outcome.gatedAtChapter, null);
  assert.equal(gate.created.length, 0, 'no Confirmations request raised at all');
  clearTimeout((e as any).saveDebounceTimer);
});
