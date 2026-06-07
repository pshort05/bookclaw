/**
 * Unit tests for the project engine's pure, network-free surface
 * (gateway/src/services/projects.ts).
 *
 * Run via: npm run test:unit  (node --test through tsx)
 *
 * Scope: the template catalog (getTemplates — now an injected catalog, sourced
 * from the library pipelines at boot) and the natural-language project type
 * heuristic (inferProjectType). Both are pure — no AI, no network. The
 * constructor only reads an optional state file; pointing it at a non-existent
 * path makes loadState() a no-op, so no fixtures are written and nothing needs
 * cleanup. Step orchestration and completion hooks need an injected AI provider
 * and are deferred until the engine is more decomposed (see the god-class
 * refactor item in docs/TODO.md).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

// A path that does not exist → loadState() returns early, constructor is inert.
function makeEngine(): ProjectEngine {
  return new ProjectEngine(undefined, join(tmpdir(), 'bookclaw-unit-test-no-such-root'));
}

// The template catalog is injected at boot from the library pipelines
// (gateway/src/init/phase-06-content.ts). Mirror that wiring here so getTemplates
// has something to return — the same shape phase-06 builds from LibraryService.list('pipeline').
const SAMPLE_CATALOG = [
  'book-planning', 'book-bible', 'book-production', 'deep-revision', 'format-export', 'book-launch', 'novel-pipeline',
].map(name => ({
  type: name as any,
  label: name,
  description: `${name} pipeline`,
  stepCount: name === 'novel-pipeline' ? 30 : 0,
  stepCountLabel: name === 'novel-pipeline' ? '30+ auto-generated steps' : undefined,
}));

function makeEngineWithCatalog(): ProjectEngine {
  const e = makeEngine();
  e.setTemplateCatalog(SAMPLE_CATALOG);
  return e;
}

// ── getTemplates() ──────────────────────────────────────────────────────────

test('getTemplates returns the injected catalog as well-formed entries', () => {
  const templates = makeEngineWithCatalog().getTemplates();
  assert.ok(templates.length > 0, 'expected at least one template');
  for (const t of templates) {
    assert.equal(typeof t.type, 'string');
    assert.ok(t.label, `template ${t.type} should have a label`);
    assert.ok(t.description, `template ${t.type} should have a description`);
    assert.equal(typeof t.stepCount, 'number');
  }
});

test('getTemplates returns an empty list when no catalog is injected', () => {
  assert.deepEqual(makeEngine().getTemplates(), []);
});

test('getTemplates exposes the core production templates and the novel pipeline', () => {
  const types = makeEngineWithCatalog().getTemplates().map(t => t.type);
  for (const expected of ['book-planning', 'book-bible', 'book-production', 'deep-revision', 'format-export', 'book-launch', 'novel-pipeline']) {
    assert.ok(types.includes(expected as never), `expected a "${expected}" template`);
  }
});

test('the novel-pipeline template advertises its auto-generated step count', () => {
  const novel = makeEngineWithCatalog().getTemplates().find(t => t.type === 'novel-pipeline');
  assert.ok(novel, 'expected a novel-pipeline template');
  assert.equal(novel!.stepCount, 30);
  assert.equal(novel!.stepCountLabel, '30+ auto-generated steps');
});

// ── inferProjectType(): natural-language → project type ─────────────────────

test('inferProjectType detects an explicit full-novel request', () => {
  const e = makeEngine();
  assert.equal(e.inferProjectType('Write a novel about a detective in 1920s Paris'), 'novel-pipeline');
  assert.equal(e.inferProjectType('I want to write a complete book from scratch'), 'novel-pipeline');
});

test('inferProjectType detects a full-pipeline request', () => {
  const e = makeEngine();
  assert.equal(e.inferProjectType('Run the full production pipeline, planning through launch'), 'pipeline');
  assert.equal(e.inferProjectType('Take this idea end-to-end through all phases'), 'pipeline');
});

test('inferProjectType maps planning, bible, and production signals', () => {
  const e = makeEngine();
  assert.equal(e.inferProjectType('Help me outline the plot and beat sheet'), 'book-planning');
  assert.equal(e.inferProjectType('Build the magic system and the world lore'), 'book-bible');
  assert.equal(e.inferProjectType('Write chapter 3'), 'book-production');
});

test('inferProjectType maps revision, format, and launch signals', () => {
  const e = makeEngine();
  // Avoid "manuscript"/"draft" here — those are book-production signals checked first.
  assert.equal(e.inferProjectType('Please proofread and rewrite this'), 'deep-revision');
  assert.equal(e.inferProjectType('Export the book to EPUB and PDF'), 'format-export');
  assert.equal(e.inferProjectType('Write the Amazon book description and blurb'), 'book-launch');
});

test('inferProjectType falls back to custom for an unrecognized request', () => {
  assert.equal(makeEngine().inferProjectType('do something vaguely creative'), 'custom');
});

// ── setStepModelOverride() ──────────────────────────────────────────────────

test('setStepModelOverride sets, normalizes, and clears a per-step override', () => {
  const e = makeEngine();
  // Inject a minimal project directly to avoid createProject's auto-persist path.
  (e as any).projects.set('p1', {
    id: 'p1', updatedAt: '',
    steps: [{ id: 's1', label: 'x', taskType: 'general', prompt: '', status: 'pending' }],
  });

  // Provider + model pins both.
  assert.deepEqual(
    e.setStepModelOverride('p1', 's1', { provider: 'openrouter', model: 'meta/llama-3.3' })?.modelOverride,
    { provider: 'openrouter', model: 'meta/llama-3.3' },
  );
  // Blank/whitespace model → provider-only pin.
  assert.deepEqual(
    e.setStepModelOverride('p1', 's1', { provider: 'claude', model: '   ' })?.modelOverride,
    { provider: 'claude' },
  );
  // null clears the override.
  assert.equal(e.setStepModelOverride('p1', 's1', null)?.modelOverride, undefined);
  // Unknown project or step returns null.
  assert.equal(e.setStepModelOverride('nope', 's1', { provider: 'claude' }), null);
  assert.equal(e.setStepModelOverride('p1', 'nostep', { provider: 'claude' }), null);

  // Cancel the debounced state write armed by the successful mutations so the
  // test process exits promptly and writes no fixture.
  clearTimeout((e as any).saveDebounceTimer);
});
