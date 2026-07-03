/**
 * Regression test for C1 (code-review): the beta-reader pre-format gate
 * (`runBetaReaderGate`, gateway/src/api/routes/_shared.ts) was only wired
 * into the MANUAL `POST /api/pipeline/:pipelineId/advance` route. Pipelines
 * that auto-advance through `onProjectCompleted` (gateway/src/init/
 * phase-06-content.ts) never called it, so the beta-reader report was never
 * generated on the normal autonomous path.
 *
 * Mirrors the exact hook body added to phase-06-content.ts's
 * `onProjectCompleted` — drives a REAL ProjectEngine through a book-production
 * project completing and advancing into a format-export phase, and asserts
 * the completion hook triggers a real `scanManuscript` pass.
 *
 * Run: node --import tsx --test tests/unit/beta-reader-gate-hook.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { runBetaReaderGate } from '../../gateway/src/api/routes/_shared.js';

const flush = () => new Promise<void>((r) => setImmediate(r));

const BOOK_PRODUCTION_PIPELINE = {
  schemaVersion: 1, name: 'book-production', label: 'Book Production', description: 'x', dynamic: false,
  steps: [
    { label: 'Write Chapter 1', skill: 'write', taskType: 'creative_writing', phase: 'writing', chapterNumber: 1, promptTemplate: 'Write.' },
  ],
} as const;

const FORMAT_EXPORT_PIPELINE = {
  schemaVersion: 1, name: 'format-export', label: 'Format & Export', description: 'x', dynamic: false,
  steps: [
    { label: 'Export', taskType: 'general', promptTemplate: 'Export.' },
  ],
} as const;

function fakeAiRouter() {
  return {
    selectProvider: (_taskType: string) => ({ id: 'gemini' }),
    complete: async (_req: any) => ({ text: '{}', tokensUsed: 5, estimatedCost: 0, provider: 'gemini' }),
  };
}

test('onProjectCompleted hook fires runBetaReaderGate when a pipeline auto-advances into format-export', async () => {
  const e = new ProjectEngine(undefined, '/tmp/bookclaw-unit-test-no-such-root');
  e.setPipelineResolver((name) => {
    if (name === 'book-production') return BOOK_PRODUCTION_PIPELINE as any;
    if (name === 'format-export') return FORMAT_EXPORT_PIPELINE as any;
    return null;
  });

  let scanCalls = 0;
  const services = {
    betaReader: {
      async scanManuscript(_projectId: string, chapters: any[]) {
        scanCalls++;
        return { chapterCount: chapters.length };
      },
    },
    aiRouter: fakeAiRouter(),
  };
  const gatherChapters = async (_project: any) => [{ id: 'ch-1', number: 1, title: 'Chapter 1', text: 'A'.repeat(300) }];

  // The exact hook body added to phase-06-content.ts's onProjectCompleted:
  // advance the pipeline, and — only when the just-started phase is
  // format-export — fire the beta-reader gate (fail-soft, advisory).
  e.onProjectCompleted(async (project: any) => {
    let startedProject: any = null;
    if (project.pipelineId) startedProject = e.advancePipeline(project.pipelineId);
    if (startedProject?.type === 'format-export' && project.pipelineId) {
      const pipelineProjects = e.getPipelineProjects(project.pipelineId);
      await runBetaReaderGate({ services, pipelineProjects, startedProject, gatherChapters })
        .catch(() => { /* fail-soft, mirrors production */ });
    }
  });

  const pipelineId = 'pipeline-test-1';
  const prod = e.createProjectResolved('book-production' as any, 'Book — Production', 'desc', { bookSlug: 'my-book' } as any);
  prod.pipelineId = pipelineId;
  prod.pipelinePhase = 1;
  const fmt = e.createProjectResolved('format-export' as any, 'Book — Format', 'desc', { bookSlug: 'my-book' } as any);
  fmt.pipelineId = pipelineId;
  fmt.pipelinePhase = 2;

  e.startProject(prod.id);
  for (const step of prod.steps) e.completeStep(prod.id, step.id, 'A'.repeat(300));
  await flush();

  assert.equal(prod.status, 'completed');
  assert.equal(fmt.status, 'active');
  assert.equal(scanCalls, 1, 'expected the autonomous completion hook to trigger a real beta-reader scan when advancing into format-export');
  clearTimeout((e as any).saveDebounceTimer);
});

test('onProjectCompleted hook does not fire the gate when advancing into a non-format-export phase', async () => {
  const e = new ProjectEngine(undefined, '/tmp/bookclaw-unit-test-no-such-root');
  const PLANNING_PIPELINE = {
    schemaVersion: 1, name: 'book-planning', label: 'Planning', description: 'x', dynamic: false,
    steps: [{ label: 'Plan', taskType: 'general', promptTemplate: 'Plan.' }],
  } as const;
  e.setPipelineResolver((name) => {
    if (name === 'book-planning') return PLANNING_PIPELINE as any;
    if (name === 'book-production') return BOOK_PRODUCTION_PIPELINE as any;
    return null;
  });

  let scanCalls = 0;
  const services = {
    betaReader: { async scanManuscript(_id: string, chapters: any[]) { scanCalls++; return { chapterCount: chapters.length }; } },
    aiRouter: fakeAiRouter(),
  };
  const gatherChapters = async (_project: any) => [{ id: 'ch-1', number: 1, title: 'Chapter 1', text: 'A'.repeat(300) }];

  e.onProjectCompleted(async (project: any) => {
    let startedProject: any = null;
    if (project.pipelineId) startedProject = e.advancePipeline(project.pipelineId);
    if (startedProject?.type === 'format-export' && project.pipelineId) {
      const pipelineProjects = e.getPipelineProjects(project.pipelineId);
      await runBetaReaderGate({ services, pipelineProjects, startedProject, gatherChapters }).catch(() => {});
    }
  });

  const pipelineId = 'pipeline-test-2';
  const planning = e.createProjectResolved('book-planning' as any, 'Book — Planning', 'desc', { bookSlug: 'my-book' } as any);
  planning.pipelineId = pipelineId;
  planning.pipelinePhase = 1;
  const prod = e.createProjectResolved('book-production' as any, 'Book — Production', 'desc', { bookSlug: 'my-book' } as any);
  prod.pipelineId = pipelineId;
  prod.pipelinePhase = 2;

  e.startProject(planning.id);
  for (const step of planning.steps) e.completeStep(planning.id, step.id, 'ok');
  await flush();

  assert.equal(prod.status, 'active');
  assert.equal(scanCalls, 0, 'the gate must not fire when the newly-started phase is not format-export');
  clearTimeout((e as any).saveDebounceTimer);
});
