/**
 * Regression: the Write page must bind to the book's FRONTIER project (the
 * chained pipeline's current phase) so the rail shows live progress and its
 * actions target that project — previously Write left the project unbound and
 * only showed the pipeline template. ProjectEngine.frontierProjectForBook(slug)
 * resolves the frontier: the lowest-phase project that isn't completed (or the
 * last phase when the whole pipeline is done).
 *
 * Run: node --import tsx --test tests/unit/book-frontier-project.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

const PIPELINE = {
  schemaVersion: 1, name: 'book-planning', label: 'Plan', description: 'd', dynamic: false,
  steps: [{ label: 'One', taskType: 'general', promptTemplate: 'x' }],
} as const;

function makeEngine() {
  // Unique empty root per engine so loadState() finds no stale state file (the
  // debounced persistState writes to rootDir — a shared path would leak projects
  // across tests/runs).
  const e = new ProjectEngine(undefined, mkdtempSync(join(tmpdir(), 'bookclaw-frontier-')));
  e.setPipelineResolver(() => (PIPELINE as any));
  return e;
}
const quiesce = (e: ProjectEngine) => clearTimeout((e as any).saveDebounceTimer);

/** Create a project bound to `slug` with an explicit pipeline phase + status. */
function phaseProj(e: ProjectEngine, slug: string, phase: number, status: string, pipelineId = 'pl-1') {
  const p = e.createProjectResolved('book-planning' as any, `P${phase}`, 'd', { bookSlug: slug } as any);
  (p as any).pipelinePhase = phase;
  (p as any).pipelineId = pipelineId;
  p.status = status as any;
  return p;
}

test('frontier = lowest-phase project that is not completed (Planning done → Bible)', () => {
  const e = makeEngine();
  phaseProj(e, 'book-a', 1, 'completed'); // planning
  const bible = phaseProj(e, 'book-a', 2, 'pending'); // bible
  phaseProj(e, 'book-a', 3, 'pending'); // production
  assert.equal(e.frontierProjectForBook('book-a')?.id, bible.id);
  quiesce(e);
});

test('frontier ignores other books\' projects', () => {
  const e = makeEngine();
  phaseProj(e, 'book-a', 1, 'completed');
  const aBible = phaseProj(e, 'book-a', 2, 'pending');
  phaseProj(e, 'book-b', 1, 'pending'); // different book
  assert.equal(e.frontierProjectForBook('book-a')?.id, aBible.id);
  quiesce(e);
});

test('all phases completed → returns the last (highest) phase so the rail shows the finished state', () => {
  const e = makeEngine();
  phaseProj(e, 'book-a', 1, 'completed');
  phaseProj(e, 'book-a', 2, 'completed');
  const last = phaseProj(e, 'book-a', 3, 'completed');
  assert.equal(e.frontierProjectForBook('book-a')?.id, last.id);
  quiesce(e);
});

test('an active phase is the frontier even with later pending phases', () => {
  const e = makeEngine();
  phaseProj(e, 'book-a', 1, 'completed');
  const active = phaseProj(e, 'book-a', 2, 'active');
  phaseProj(e, 'book-a', 3, 'pending');
  assert.equal(e.frontierProjectForBook('book-a')?.id, active.id);
  quiesce(e);
});

test('with DUPLICATE pipelines, picks the most-progressed one then its frontier (ignores fresh dup planning)', () => {
  // Repeated "start" clicks created extra fresh pipelines (the bug). The original
  // pipeline (Planning done → Bible pending) must win over a fresh duplicate whose
  // Planning is merely pending, so the frontier is the original's Bible.
  const e = makeEngine();
  // original pipeline pl-1: planning completed, bible pending
  phaseProj(e, 'book-a', 1, 'completed', 'pl-1');
  const realBible = phaseProj(e, 'book-a', 2, 'pending', 'pl-1');
  // duplicate fresh pipeline pl-2: nothing completed
  phaseProj(e, 'book-a', 1, 'paused', 'pl-2');
  phaseProj(e, 'book-a', 2, 'pending', 'pl-2');
  assert.equal(e.frontierProjectForBook('book-a')?.id, realBible.id);
  quiesce(e);
});

test('returns null for an unknown book or empty slug', () => {
  const e = makeEngine();
  phaseProj(e, 'book-a', 1, 'pending');
  assert.equal(e.frontierProjectForBook('no-such-book'), null);
  assert.equal(e.frontierProjectForBook(''), null);
  quiesce(e);
});
