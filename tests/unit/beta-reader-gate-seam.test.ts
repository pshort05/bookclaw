/**
 * Integration-seam tests for `runBetaReaderGate` (gateway/src/api/routes/_shared.ts)
 * — Task 3's "beta-reader panel pass before format as a gate input", wired
 * into `/api/pipeline/:pipelineId/advance` when a pipeline advances INTO its
 * format-export phase.
 *
 * The fake `services.aiRouter` mirrors AIRouter.complete/selectProvider's
 * real signatures; a wrong-shape/undefined provider throws (mirroring the
 * real router), so a mis-wire that fails to pass a concrete provider id
 * surfaces here rather than silently degrading.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBetaReaderGate } from '../../gateway/src/api/routes/_shared.js';

const CHAPTERS = [
  { id: 'ch-1', number: 1, title: 'Chapter 1', text: 'A'.repeat(300) },
];

function fakeAiRouter() {
  return {
    selectProvider: (_taskType: string) => ({ id: 'gemini' }),
    complete: async (req: any) => {
      if (req.provider !== 'gemini') throw new Error(`unexpected provider "${req.provider}"`);
      return {
        text: JSON.stringify({ tension: 7, pacing: 'good', wantToContinue: 80, confusion: [], favoriteMoment: 'x', stumblePoint: '', emotions: ['curiosity'], overallNote: 'Solid.' }),
        tokensUsed: 10, estimatedCost: 0, provider: 'gemini',
      };
    },
  };
}

function fakeBetaReader() {
  return {
    getArchetypes: () => [{ id: 'genre-fan', name: 'Devoted Genre Fan', description: '', preferences: [], pet_peeves: [] }],
    async scanManuscript(projectId: string, chapters: any[], aiComplete: any, aiSelectProvider: any) {
      // Mirrors the real BetaReaderService.scanManuscript signature — drives
      // the injected aiComplete/aiSelectProvider for real so a wrong-shape
      // provider id would throw via the fake aiRouter above.
      const provider = aiSelectProvider('consistency');
      for (const ch of chapters) {
        await aiComplete({ provider: provider.id, system: 's', messages: [{ role: 'user', content: ch.text }], maxTokens: 100 });
      }
      return {
        projectId, generatedAt: new Date().toISOString(), chapterCount: chapters.length, archetypeCount: 1,
        feedback: [], aggregate: { avgTension: 7, avgWantToContinue: 80, weakestChapter: null, strongestChapter: null, topEmotions: [], topConfusions: [] },
      };
    },
  };
}

function formatExportProject() {
  return { id: 'fmt-1', type: 'format-export', pipelinePhase: 5, status: 'active' };
}

function completedProductionProject(bookSlug = 'my-book') {
  return { id: 'prod-1', type: 'book-production', pipelinePhase: 3, status: 'completed', bookSlug, title: 'My Book — Production', steps: [] };
}

test('runBetaReaderGate: triggers a real scanManuscript pass when advancing into format-export', async () => {
  const services = { betaReader: fakeBetaReader(), aiRouter: fakeAiRouter() };
  const pipelineProjects = [completedProductionProject(), formatExportProject()];
  const result = await runBetaReaderGate({
    services, pipelineProjects, startedProject: formatExportProject(),
    gatherChapters: async () => CHAPTERS,
  });
  assert.equal(result.triggered, true);
  assert.equal(result.report.chapterCount, 1);
});

test('runBetaReaderGate: no-op when the started project is not format-export', async () => {
  const services = { betaReader: fakeBetaReader(), aiRouter: fakeAiRouter() };
  const pipelineProjects = [completedProductionProject()];
  const result = await runBetaReaderGate({
    services, pipelineProjects, startedProject: { id: 'x', type: 'deep-revision' },
    gatherChapters: async () => CHAPTERS,
  });
  assert.equal(result.triggered, false);
});

test('runBetaReaderGate: no-op when there is no completed book-production sibling', async () => {
  const services = { betaReader: fakeBetaReader(), aiRouter: fakeAiRouter() };
  const pipelineProjects = [{ ...completedProductionProject(), status: 'active' }, formatExportProject()];
  const result = await runBetaReaderGate({
    services, pipelineProjects, startedProject: formatExportProject(),
    gatherChapters: async () => CHAPTERS,
  });
  assert.equal(result.triggered, false);
});

test('runBetaReaderGate: no-op when there are no completed chapters to scan', async () => {
  const services = { betaReader: fakeBetaReader(), aiRouter: fakeAiRouter() };
  const pipelineProjects = [completedProductionProject(), formatExportProject()];
  const result = await runBetaReaderGate({
    services, pipelineProjects, startedProject: formatExportProject(),
    gatherChapters: async () => [],
  });
  assert.equal(result.triggered, false);
});

test('runBetaReaderGate: a scan failure degrades to not-triggered without throwing', async () => {
  const services = {
    betaReader: { scanManuscript: async () => { throw new Error('AI provider failure'); } },
    aiRouter: fakeAiRouter(),
  };
  const pipelineProjects = [completedProductionProject(), formatExportProject()];
  const result = await runBetaReaderGate({
    services, pipelineProjects, startedProject: formatExportProject(),
    gatherChapters: async () => CHAPTERS,
  });
  assert.equal(result.triggered, false);
});

test('runBetaReaderGate: records AI spend via services.costs for each aiComplete call (M1)', async () => {
  const recorded: Array<[string, number, number | undefined, string | undefined]> = [];
  const services = {
    betaReader: fakeBetaReader(),
    aiRouter: fakeAiRouter(),
    costs: { record: (provider: string, tokens: number, cost?: number, slug?: string) => { recorded.push([provider, tokens, cost, slug]); } },
  };
  const pipelineProjects = [completedProductionProject('my-book'), formatExportProject()];
  const result = await runBetaReaderGate({
    services, pipelineProjects, startedProject: formatExportProject(),
    gatherChapters: async () => CHAPTERS,
  });
  assert.equal(result.triggered, true);
  assert.equal(recorded.length, 1, 'expected exactly one costs.record call, one per chapter scanned');
  assert.deepEqual(recorded[0], ['gemini', 10, 0, 'my-book']);
});

test('runBetaReaderGate: a missing services.costs does not throw (fail-soft)', async () => {
  const services = { betaReader: fakeBetaReader(), aiRouter: fakeAiRouter() };
  const pipelineProjects = [completedProductionProject('my-book'), formatExportProject()];
  const result = await runBetaReaderGate({
    services, pipelineProjects, startedProject: formatExportProject(),
    gatherChapters: async () => CHAPTERS,
  });
  assert.equal(result.triggered, true);
});

test('runBetaReaderGate: no-op when betaReader/aiRouter services are not wired', async () => {
  const pipelineProjects = [completedProductionProject(), formatExportProject()];
  const result = await runBetaReaderGate({
    services: {}, pipelineProjects, startedProject: formatExportProject(),
    gatherChapters: async () => CHAPTERS,
  });
  assert.equal(result.triggered, false);
});
