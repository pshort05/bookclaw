/**
 * Human-Gate Cadence (Flagship Plan 5): end-to-end through the REAL
 * `/api/projects/:id/auto-execute` route (mountProjects) — the actual
 * autonomous/dashboard execution path, not just the underlying helper — plus
 * the new `/api/projects/:id/review/action` resume endpoint (Task 3's four
 * actions). Mirrors tests/unit/drive-lock.test.ts's route-harness style.
 *
 * Run: node --import tsx --test tests/unit/gate-cadence-route.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { AddressInfo } from 'net';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { mountProjects } from '../../gateway/src/api/routes/projects.routes.js';

const TWO_CHAPTER_PIPELINE = {
  schemaVersion: 1, name: 'book-production', label: 'Production', description: 'd', dynamic: false,
  steps: [
    { label: 'Write Chapter 1', skill: 'write', taskType: 'creative_writing', phase: 'writing', chapterNumber: 1, promptTemplate: 'Write.' },
    { label: 'Write Chapter 2', skill: 'write', taskType: 'creative_writing', phase: 'writing', chapterNumber: 2, promptTemplate: 'Write.' },
  ],
} as const;

/** A real-ish confirmation gate: createRequest fails on a malformed payload
 *  (like the real ConfirmationGateService would), approve/reject/recordOutcome
 *  track state so the resume endpoint can be exercised for real. */
function fakeConfirmationGate() {
  const store = new Map<string, any>();
  let n = 0;
  return {
    async createRequest(input: any) {
      if (!input?.service || !input?.action || !input?.payload?.projectId || !input?.payload?.stepId) {
        throw new Error('malformed confirmation request');
      }
      n++;
      const id = `conf-${n}`;
      store.set(id, { id, status: 'pending', ...input });
      return { id };
    },
    checkDecision(id: string) {
      const r = store.get(id);
      return { status: r?.status ?? 'unknown', request: r ?? null };
    },
    async approve(id: string) {
      const r = store.get(id);
      if (!r) throw new Error('not found');
      r.status = 'approved';
      return r;
    },
    async reject(id: string, _decidedBy: string, reason?: string) {
      const r = store.get(id);
      if (!r) throw new Error('not found');
      r.status = 'rejected';
      r.reason = reason;
      return r;
    },
    async recordOutcome(id: string, outcome: any) {
      const r = store.get(id);
      if (!r) throw new Error('not found');
      r.outcome = outcome;
      return r;
    },
  };
}

/** Records ContextEngine.generateSummary/extractEntities calls (H1 fix) —
 *  a gated-then-resumed chapter must run these exactly like the inline
 *  drive-loop hook does. */
function fakeContextEngine() {
  const summaryCalls: any[] = [];
  const entityCalls: any[] = [];
  return {
    summaryCalls,
    entityCalls,
    async generateSummary(projectId: string, stepId: string, stepLabel: string, chapterNumber: number, fullText: string) {
      summaryCalls.push({ projectId, stepId, stepLabel, chapterNumber, fullText });
      return { chapterId: stepId };
    },
    async extractEntities(projectId: string, stepId: string, fullText: string) {
      entityCalls.push({ projectId, stepId, fullText });
      return [];
    },
  };
}

/** Real ProjectEngine driving a real 2-chapter pipeline, mounted behind the
 *  real Express route (mountProjects) — the actual autonomous/dashboard
 *  execution path, not a hand-built fixture. `url` already includes the
 *  project's `/api/projects/:id` prefix. */
async function harness(reviewCadence?: string) {
  const baseDir = mkdtempSync(join(tmpdir(), 'gatecadence-route-'));
  const engine: any = new ProjectEngine(undefined, baseDir);
  engine.setPipelineResolver(() => TWO_CHAPTER_PIPELINE as any);
  engine.buildProjectContext = async () => '';
  const project = engine.createProjectResolved('book-production' as any, 'Test Book', 'd', {});
  project.bookSlug = 'my-book';
  engine.startProject(project.id);

  const confirmationGate = fakeConfirmationGate();
  const contextEngine = fakeContextEngine();
  const aiRouter = { complete: async () => ({ text: '{}' }), selectProvider: () => ({ id: 'fake-provider' }) };
  const books = reviewCadence
    ? {
        open: async (_slug: string) => ({ manifest: { review: { cadence: reviewCadence } } }),
        skillContentOf: (_slug: string, _name: string) => null,
        dataDirOf: (_slug: string) => null,
        activeDataDir: () => null,
      }
    : null;

  // M1: the /review/action re-kick calls gateway.buildTelegramCommandHandlers()
  // (the same real method index.ts's headless driver and Telegram bridge use)
  // to get a startAndRunProject(id). This fake completes the active step
  // directly (bypassing cadence gating — already covered by other tests) so
  // the re-kick's effect is observable without a real AI call. A small delay
  // simulates a real AI call's latency — the re-kick is fire-and-forget and
  // must NOT race ahead of the HTTP response in production; without this
  // delay a synchronous fake would finish before fetch() even returns here.
  const driveCalls: string[] = [];
  const gateway = {
    getProjectEngine: () => engine,
    getServices: () => ({ books, confirmationGate, contextEngine, aiRouter, activityLog: null, heartbeat: { addWords() {} } }),
    handleMessage: async (_m: string, _c: string, cb: (t: string) => void) => { cb('Real chapter prose. '.repeat(30)); },
    buildTelegramCommandHandlers: () => ({
      startAndRunProject: async (id: string) => {
        await new Promise((r) => setTimeout(r, 50));
        const p = engine.getProject(id);
        const activeStep = p?.steps.find((s: any) => s.status === 'active');
        if (!activeStep) return { error: 'no active step' };
        driveCalls.push(activeStep.id);
        engine.completeStep(id, activeStep.id, 'Regenerated prose. '.repeat(20));
        return { completed: activeStep.id, response: 'x', wordCount: 3 };
      },
    }),
  };
  const app = express();
  app.use(express.json());
  mountProjects(app as any, gateway, baseDir);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/api/projects/${project.id}`, server, engine, project, contextEngine, driveCalls };
}

const postJson = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

/** Poll for a fire-and-forget background drive to run (M1's re-kick is
 *  deliberately not awaited by the HTTP response — a long chapter chain must
 *  never block it). */
async function waitFor(check: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('/auto-execute pauses a per_chapter book at chapter 1 with a real Confirmations request', async () => {
  const { url, server, project } = await harness('per_chapter');
  try {
    const res = await postJson(`${url}/auto-execute`, {});
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.humanReview, true);
    assert.ok(body.confirmationId);
    assert.equal(project.status, 'paused');
    assert.equal(project.review?.kind, 'cadence-gate');
    assert.ok(project.review?.pendingResult?.includes('Real chapter prose.'));
    assert.equal(project.steps[0].status, 'active', 'not completed while gated');
    assert.equal(project.steps[1].status, 'pending', 'chapter 2 must not have started');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/auto-execute never gates an autonomous-cadence book on chapters', async () => {
  const { url, server, project } = await harness('autonomous');
  try {
    const res = await postJson(`${url}/auto-execute`, {});
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.humanReview, undefined);
    assert.equal(project.status, 'completed');
    assert.equal(project.steps[0].status, 'completed');
    assert.equal(project.steps[1].status, 'completed');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/review/action approve resumes with the real drafted text and completes the chapter', async () => {
  const { url, server, project } = await harness('per_chapter');
  try {
    await postJson(`${url}/auto-execute`, {});
    assert.equal(project.status, 'paused');
    const pending = project.review.pendingResult;

    const res = await postJson(`${url}/review/action`, { action: 'approve' });
    assert.equal(res.status, 200);
    assert.equal(project.steps[0].status, 'completed');
    assert.equal(project.steps[0].result, pending);
    assert.equal(project.steps[1].status, 'active', 'chapter 2 now runnable');
    assert.equal(project.status, 'active');
    assert.equal(project.review, undefined);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/review/action edit completes the chapter with human-supplied text instead of the draft', async () => {
  const { url, server, project } = await harness('per_chapter');
  try {
    await postJson(`${url}/auto-execute`, {});

    const res = await postJson(`${url}/review/action`, { action: 'edit', editedText: 'A human-rewritten chapter.' });
    assert.equal(res.status, 200);
    assert.equal(project.steps[0].status, 'completed');
    assert.equal(project.steps[0].result, 'A human-rewritten chapter.');
    assert.equal(project.steps[1].status, 'active');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/review/action approve on a gated chapter runs ContextEngine summary + entity extraction (H1)', async () => {
  const { url, server, project, contextEngine } = await harness('per_chapter');
  try {
    await postJson(`${url}/auto-execute`, {});
    const pending = project.review.pendingResult;

    await postJson(`${url}/review/action`, { action: 'approve' });

    assert.equal(contextEngine.summaryCalls.length, 1, 'summary generated for the gated-then-approved chapter');
    assert.equal(contextEngine.summaryCalls[0].fullText, pending);
    assert.equal(contextEngine.summaryCalls[0].chapterNumber, 1);
    assert.equal(contextEngine.entityCalls.length, 1);
    assert.equal(contextEngine.entityCalls[0].fullText, pending);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/review/action edit runs extraction with the human-edited text, not the draft (H1)', async () => {
  const { url, server, contextEngine } = await harness('per_chapter');
  try {
    await postJson(`${url}/auto-execute`, {});
    const editedText = 'A human-rewritten chapter. '.repeat(20);

    await postJson(`${url}/review/action`, { action: 'edit', editedText });

    assert.equal(contextEngine.summaryCalls.length, 1);
    assert.equal(contextEngine.summaryCalls[0].fullText, editedText);
    assert.equal(contextEngine.entityCalls.length, 1);
    assert.equal(contextEngine.entityCalls[0].fullText, editedText);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/review/action regenerate does NOT run extraction — the step was not completed', async () => {
  const { url, server, contextEngine } = await harness('per_chapter');
  try {
    await postJson(`${url}/auto-execute`, {});
    await postJson(`${url}/review/action`, { action: 'regenerate', note: 'Slow down the pacing.' });

    assert.equal(contextEngine.summaryCalls.length, 0);
    assert.equal(contextEngine.entityCalls.length, 0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/review/action regenerate reactivates the same step with a note, leaving chapter 2 pending', async () => {
  const { url, server, project } = await harness('per_chapter');
  try {
    await postJson(`${url}/auto-execute`, {});

    const res = await postJson(`${url}/review/action`, { action: 'regenerate', note: 'Slow down the pacing.' });
    assert.equal(res.status, 200);
    assert.equal(project.steps[0].status, 'active', 'reactivated, not completed');
    assert.equal(project.steps[0].result, undefined);
    assert.equal(project.steps[0].regenerateNote, 'Slow down the pacing.');
    assert.equal(project.steps[1].status, 'pending');
    assert.equal(project.status, 'active');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/review/action regenerate triggers a re-drive so an API/headless caller does not strand (M1)', async () => {
  const { url, server, project, driveCalls } = await harness('per_chapter');
  try {
    await postJson(`${url}/auto-execute`, {});
    const step0Id = project.steps[0].id;

    const res = await postJson(`${url}/review/action`, { action: 'regenerate', note: 'Slow down the pacing.' });
    assert.equal(res.status, 200);
    assert.equal(project.steps[0].status, 'active', 'reactivated by the resume itself');

    // The re-kick runs in the background (must not block this response) — wait
    // for it to pick up the reactivated step and drive it forward.
    await waitFor(() => driveCalls.length > 0);
    assert.deepEqual(driveCalls, [step0Id], 'the re-drive picked up the SAME reactivated step');
    await waitFor(() => project.steps[0].status === 'completed');
    assert.equal(project.steps[1].status, 'active', 'drive continued past the regenerated chapter');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/review/action approve also triggers a re-drive for the next step (M1)', async () => {
  const { url, server, project, driveCalls } = await harness('per_chapter');
  try {
    await postJson(`${url}/auto-execute`, {});
    const res = await postJson(`${url}/review/action`, { action: 'approve' });
    assert.equal(res.status, 200);
    assert.equal(project.steps[1].status, 'active', 'chapter 2 now runnable');

    await waitFor(() => driveCalls.length > 0);
    assert.deepEqual(driveCalls, [project.steps[1].id], 'the re-drive advances chapter 2, not chapter 1 again');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/review/action stop does NOT trigger a re-drive (project stays paused, human declined)', async () => {
  const { url, server, project, driveCalls } = await harness('per_chapter');
  try {
    await postJson(`${url}/auto-execute`, {});
    await postJson(`${url}/review/action`, { action: 'stop' });
    // Give any errant background drive a moment to fire, then confirm it didn't.
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(driveCalls.length, 0);
    assert.equal(project.status, 'paused');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/review/action stop leaves the project paused with no step change', async () => {
  const { url, server, project } = await harness('per_chapter');
  try {
    await postJson(`${url}/auto-execute`, {});

    const res = await postJson(`${url}/review/action`, { action: 'stop' });
    assert.equal(res.status, 200);
    assert.equal(project.steps[0].status, 'active');
    assert.equal(project.status, 'paused');
    assert.equal(project.review, undefined);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/review/action 409s when no review is pending', async () => {
  const { url, server } = await harness('autonomous');
  try {
    const res = await postJson(`${url}/review/action`, { action: 'approve' });
    assert.equal(res.status, 409);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/review/action 400s on an unknown action or a missing editedText for edit', async () => {
  const { url, server } = await harness('per_chapter');
  try {
    await postJson(`${url}/auto-execute`, {});

    const bad = await postJson(`${url}/review/action`, { action: 'nonsense' });
    assert.equal(bad.status, 400);

    const noText = await postJson(`${url}/review/action`, { action: 'edit' });
    assert.equal(noText.status, 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// ── /review/save-draft: "Save (keep paused)" — persist an inline edit to the
//    paused chapter WITHOUT resuming; a later approve resumes with it. ─────────

test('/review/save-draft persists the edited draft and keeps the project paused (no resume)', async () => {
  const { url, server, project } = await harness('per_chapter');
  try {
    await postJson(`${url}/auto-execute`, {});
    assert.equal(project.status, 'paused');

    const res = await postJson(`${url}/review/save-draft`, { editedText: 'A human-saved chapter.' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.project.review.pendingResult, 'A human-saved chapter.');
    // Still parked — a save must NOT resume the pipeline.
    assert.equal(project.status, 'paused');
    assert.ok(project.review, 'review still pending');
    assert.equal(project.steps[0].status, 'active', 'chapter 1 not completed by a save');
    assert.equal(project.steps[1].status, 'pending', 'chapter 2 must not have started');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/review/save-draft then approve resumes the chapter with the saved edited text', async () => {
  const { url, server, project } = await harness('per_chapter');
  try {
    await postJson(`${url}/auto-execute`, {});

    await postJson(`${url}/review/save-draft`, { editedText: 'Saved-then-approved prose.' });
    const res = await postJson(`${url}/review/action`, { action: 'approve' });
    assert.equal(res.status, 200);
    assert.equal(project.steps[0].status, 'completed');
    assert.equal(project.steps[0].result, 'Saved-then-approved prose.', 'approve used the saved edit, not the original draft');
    assert.equal(project.steps[1].status, 'active');
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/review/save-draft 409s when no review is pending', async () => {
  const { url, server } = await harness('autonomous');
  try {
    const res = await postJson(`${url}/review/save-draft`, { editedText: 'x' });
    assert.equal(res.status, 409);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('/review/save-draft 400s when editedText is missing or not a string', async () => {
  const { url, server } = await harness('per_chapter');
  try {
    await postJson(`${url}/auto-execute`, {});

    const missing = await postJson(`${url}/review/save-draft`, {});
    assert.equal(missing.status, 400);

    const notString = await postJson(`${url}/review/save-draft`, { editedText: 42 });
    assert.equal(notString.status, 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
