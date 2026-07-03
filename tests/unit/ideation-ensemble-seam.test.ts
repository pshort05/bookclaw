/**
 * Task 4 integration-seam tests for `resolveEnsemblePremise`
 * (gateway/src/api/routes/_shared.ts) — the phase seam that wires Task 1's
 * `runIdeationEnsemble` + Task 2's `selectPitch` into the premise phase.
 * Mirrors tests/unit/grounding-research-seam.test.ts's approach: call the
 * wiring function directly with a fake `services` object rather than through
 * the Express route (the route handlers themselves are exercised by
 * tests/smoke-test.sh, not unit tests).
 *
 * Per the "inert in production" lesson: the fake `aiRouter.complete` THROWS
 * on any provider id it doesn't recognize (mirroring AIRouter.complete's real
 * `Provider ${id} not found`), so a wrong panel-member -> provider mapping in
 * the wiring would surface as a failed/empty ensemble here, not silently pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEnsemblePremise } from '../../gateway/src/api/routes/_shared.js';
import { AI_PROVIDER_IDS } from '../../gateway/src/ai/router.js';

const REGISTERED = new Set<string>(AI_PROVIDER_IDS);

function throwingComplete(overrides: Partial<Record<string, () => string>> = {}) {
  return async (req: any) => {
    if (!req.provider || !REGISTERED.has(req.provider)) {
      throw new Error(`Provider ${req.provider} not found`);
    }
    const override = overrides[req.provider];
    return { text: override ? override() : `pitch text from ${req.provider}/${req.model ?? 'default'} — plenty of words to pass the length checks in the pipeline.`, tokensUsed: 100, estimatedCost: 0.01, provider: req.provider };
  };
}

function fakeServices(overrides: any = {}) {
  return {
    books: {
      open: async (_slug: string) => ({ manifest: { ensemble: { enabled: true }, pulledFrom: { genre: { name: 'romance' } } } }),
    },
    aiRouter: {
      complete: throwingComplete(),
      selectProvider: (_taskType: string) => ({ id: 'claude' }),
    },
    costs: { record: (..._args: any[]) => {} },
    ...overrides,
  };
}

function fakeProject(overrides: any = {}) {
  return { id: 'p1', bookSlug: 'my-book', steps: [], context: {}, ...overrides };
}

const premiseStep = { id: 'step-1', phase: 'premise' };

test('ensemble.enabled:false (no ensemble block) runs the normal single-model premise step — active:false', async () => {
  const services = fakeServices({ books: { open: async () => ({ manifest: { pulledFrom: { genre: { name: 'romance' } } } }) } });
  const result = await resolveEnsemblePremise({ services, project: fakeProject(), step: premiseStep, userMessage: 'seed premise' });
  assert.equal(result.active, false);
});

test('ensemble.enabled:true runs the fan-out + judge and the selected pitch becomes the premise', async () => {
  const services = fakeServices();
  const result = await resolveEnsemblePremise({ services, project: fakeProject(), step: premiseStep, userMessage: 'A lighthouse keeper discovers the sea is keeping a secret.' });
  assert.equal(result.active, true);
  assert.ok(result.premiseText && result.premiseText.length > 0);
  assert.equal(result.pitches?.length, 4); // default panel [gpt, grok, gemini, claude]
});

test('every panel-member complete() call and the judge call use a REAL router-registered provider id', async () => {
  const seenProviders: string[] = [];
  const services = fakeServices({
    aiRouter: {
      complete: async (req: any) => {
        seenProviders.push(req.provider);
        if (!req.provider || !REGISTERED.has(req.provider)) throw new Error(`Provider ${req.provider} not found`);
        return { text: 'a pitch with plenty of words to pass length checks in the ensemble pipeline test.', tokensUsed: 50, estimatedCost: 0.005, provider: req.provider };
      },
      selectProvider: () => ({ id: 'claude' }),
    },
  });
  await resolveEnsemblePremise({ services, project: fakeProject(), step: premiseStep, userMessage: 'seed' });
  // 4 panel calls + 1 judge call = 5
  assert.equal(seenProviders.length, 5);
  for (const p of seenProviders) assert.ok(REGISTERED.has(p), `saw unregistered provider "${p}"`);
});

test('the CostTracker records every panel call AND the judge call', async () => {
  const recorded: Array<[string, number, number | undefined, string | undefined]> = [];
  const services = fakeServices({ costs: { record: (...args: any[]) => recorded.push(args as any) } });
  await resolveEnsemblePremise({ services, project: fakeProject(), step: premiseStep, userMessage: 'seed' });
  assert.equal(recorded.length, 5); // 4 panel + 1 judge
  for (const [, , , slug] of recorded) assert.equal(slug, 'my-book');
});

test('a non-premise step is a no-op', async () => {
  const services = fakeServices();
  const result = await resolveEnsemblePremise({ services, project: fakeProject(), step: { id: 's', phase: 'bible' }, userMessage: 'x' });
  assert.equal(result.active, false);
});

test('the SECOND premise step ("Refine premise", after the first has completed) is a no-op — it refines the ensemble output via the normal path', async () => {
  const services = fakeServices();
  const project = fakeProject({ steps: [{ id: 'step-1', phase: 'premise', status: 'completed', result: 'chosen pitch text' }] });
  const result = await resolveEnsemblePremise({ services, project, step: { id: 'step-2', phase: 'premise' }, userMessage: 'refine this' });
  assert.equal(result.active, false);
});

test('a project not bound to a book is a no-op', async () => {
  const services = fakeServices();
  const result = await resolveEnsemblePremise({ services, project: fakeProject({ bookSlug: undefined }), step: premiseStep, userMessage: 'x' });
  assert.equal(result.active, false);
});

test('an unavailable/misconfigured judge provider (selectProvider throws) fails soft to active:false, not a throw', async () => {
  const services = fakeServices({
    aiRouter: {
      complete: throwingComplete(),
      selectProvider: () => { throw new Error('No AI providers available.'); },
    },
  });
  const result = await resolveEnsemblePremise({ services, project: fakeProject(), step: premiseStep, userMessage: 'seed' });
  assert.equal(result.active, false);
});

test('every panel member unavailable (all complete calls throw) fails soft to active:false, not a throw', async () => {
  const services = fakeServices({
    aiRouter: {
      complete: async () => { throw new Error('Provider not found'); },
      selectProvider: () => ({ id: 'claude' }),
    },
  });
  const result = await resolveEnsemblePremise({ services, project: fakeProject(), step: premiseStep, userMessage: 'seed' });
  assert.equal(result.active, false);
});

test('an explicit book-level ensemble.panel overrides the genre sheet default', async () => {
  const seenProviders: string[] = [];
  const services = fakeServices({
    books: { open: async () => ({ manifest: { ensemble: { enabled: true, panel: ['claude', 'gemini'] }, pulledFrom: { genre: { name: 'romance' } } } }) },
    aiRouter: {
      complete: async (req: any) => {
        seenProviders.push(req.provider);
        if (!req.provider || !REGISTERED.has(req.provider)) throw new Error(`Provider ${req.provider} not found`);
        return { text: 'a pitch with plenty of words for the ensemble test to pass length checks here.', tokensUsed: 10, estimatedCost: 0.001, provider: req.provider };
      },
      selectProvider: () => ({ id: 'claude' }),
    },
  });
  const result = await resolveEnsemblePremise({ services, project: fakeProject(), step: premiseStep, userMessage: 'seed' });
  assert.equal(result.pitches?.length, 2);
  // claude -> 'claude', gemini -> 'gemini'; judge also uses 'claude' (selectProvider stub) = 3 calls total
  assert.equal(seenProviders.filter(p => p !== 'claude').length, 1);
});
