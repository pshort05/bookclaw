// tests/unit/spine-inject-wiring.test.ts
// H2 fix: proves startAndRunProject (index.ts's headless/autonomous step-driver
// — used by the phase-10 headless driver, Telegram/Discord /novel, boot-resume,
// and review-gate resume) actually calls the new spine-inject helpers on a
// draft step, not just that the helpers work in isolation (spine-inject.test.ts
// covers that). Drives the REAL method off the exported BookClawGateway class
// via `buildTelegramCommandHandlers.call(fakeGateway)` — the class's methods
// read all their dependencies off `this`, so a fake object satisfying the
// properties startAndRunProject actually touches exercises the real method
// body, not a hand-rolled re-implementation (which is what the existing
// gate-cadence-route.test.ts harness uses and would NOT catch this wiring
// being removed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BookClawGateway } from '../../gateway/src/index.js';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { ConsistencyStore } from '../../gateway/src/services/consistency/fact-store.js';
import type { LedgerFact } from '../../gateway/src/services/consistency/types.js';

const DRAFT_PIPELINE = {
  schemaVersion: 1, name: 'book-production', label: 'Production', description: 'd', dynamic: false,
  steps: [
    { label: 'Write Chapter 1', skill: undefined, taskType: 'creative_writing', phase: 'writing', chapterNumber: 1, role: 'draft', promptTemplate: 'Write chapter 1.' },
  ],
} as const;

function fact(p: Partial<LedgerFact>): LedgerFact {
  return {
    world: null, bookSlug: 'b1', entity: 'Anna', aliases: ['Anna'], attribute: 'eye_color',
    type: 'immutable', valueRaw: 'brown eyes', valueNorm: 'brown', storyTime: 0, storyElapsed: 0, timeLabel: null,
    transition: null, chapter: 'chapter-1', scene: 0, source: 'manuscript', evidence: 'brown eyes', canonical: true, ...p,
  };
}

const CHAPTER_PROSE = 'Bob walked to the old lighthouse under a bruised sky. '.repeat(10);

test('startAndRunProject: pre-draft injects the real ledger, post-draft persists the drafted chapter\'s facts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'spine-wiring-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }

    // Seed a prior fact so the pre-draft ledger block is non-empty and
    // identifiable in the captured prompt context.
    store.insertFacts([fact({ chapter: 'chapter-1', entity: 'Anna', attribute: 'eye_color', valueRaw: 'brown eyes', valueNorm: 'brown' })]);

    const baseDir = mkdtempSync(join(root, 'engine-'));
    const dataDir = mkdtempSync(join(root, 'data-'));
    const engine: any = new ProjectEngine(undefined, baseDir);
    engine.setPipelineResolver(() => DRAFT_PIPELINE as any);
    engine.buildProjectContext = async () => '';
    const project = engine.createProjectResolved('book-production' as any, 'Test Book', 'd', {});
    project.bookSlug = 'b1';
    engine.startProject(project.id);
    assert.equal(project.steps[0].role, 'draft', 'sanity: the pipeline step resolved to role=draft');

    let capturedContext = '';
    let extractionCalled = false;
    const REGISTERED = new Set(['claude']);

    const fakeGateway: any = {
      projectEngine: engine,
      books: {
        open: async () => ({ manifest: {} }),
        dataDirOf: () => dataDir,
        activeDataDir: () => null,
        skillContentOf: () => null,
      },
      skills: undefined,
      aiRouter: {
        async complete(req: any) {
          extractionCalled = true;
          if (!REGISTERED.has(req?.provider)) throw new Error(`Provider ${req?.provider} not found`);
          return {
            text: JSON.stringify({
              scenes: [{ timeLabel: null, canonical: true }],
              facts: [{
                entity: 'Bob', aliases: ['Bob'], attribute: 'location', type: 'stateful',
                valueRaw: 'the old lighthouse', valueNorm: 'lighthouse', scene: 0, transition: null,
                evidence: 'Bob walked to the old lighthouse',
              }],
              knowledgeEvents: [],
            }),
          };
        },
        selectProvider: () => ({ id: 'claude' }),
        getActiveProviders: () => [{ id: 'claude' }],
      },
      costs: undefined,
      confirmationGate: undefined,
      activityLog: { log: () => {} },
      heartbeat: { addWords: () => {}, getAutonomousStatus: () => undefined },
      contextEngine: {
        generateSummary: async () => ({}),
        extractEntities: async () => ([]),
      },
      consistencyStore: store,
      consistencyJobs: { isRunning: () => false },
      // The real generation call — replaced with a fake that hands back fixed
      // prose and records the prompt context it was given, so the test can
      // inspect what the pre-draft injection actually appended.
      async handleMessage(
        _message: string, _source: string, callback: (t: string) => void, context: string,
      ) {
        capturedContext = context;
        callback(CHAPTER_PROSE);
      },
    };

    const handlers = BookClawGateway.prototype.buildTelegramCommandHandlers.call(fakeGateway);
    const result: any = await handlers.startAndRunProject(project.id);

    assert.ok(!('error' in result), `startAndRunProject returned an error: ${JSON.stringify(result)}`);
    assert.equal(project.steps[0].status, 'completed');

    // Pre-draft: the real ledger, pulled from the real store, was appended to
    // the prompt context handed to the generation call. This assertion FAILS
    // if the buildContinuityInjection call in index.ts is removed — capturedContext
    // would stay whatever buildProjectContext + buildBookCanonBlock produced,
    // with no CONTINUITY LEDGER section.
    assert.match(capturedContext, /CONTINUITY LEDGER/, 'pre-draft ledger block was injected into the generation prompt');
    assert.match(capturedContext, /Anna\.eye_color: brown eyes/, 'the seeded ledger fact appears in the injected block');

    // Post-draft: the drafted chapter's own fact was extracted AND persisted to
    // the real store. This assertion FAILS if the detectPostDraftContinuity
    // call in index.ts is removed — extractionCalled stays false and no
    // "Bob.location" row is ever written.
    assert.equal(extractionCalled, true, 'post-draft extraction actually ran through gateway.aiRouter.complete');
    const persisted = store.factsForBook({ world: null, bookSlug: 'b1' });
    assert.ok(
      persisted.some(f => f.entity === 'Bob' && f.attribute === 'location' && f.chapter === 'chapter-1' && f.source === 'manuscript'),
      'the drafted chapter\'s extracted fact was persisted to the ledger',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
