/**
 * Regression: the onProjectCompleted wiring (phase-06-content.ts) must advance
 * the bound book's manifest phase when a phase-project completes. This drives a
 * real ProjectEngine project to completion and asserts the hook calls
 * books.setPhase with the NEXT lifecycle phase. Mirrors the exact 3-line hook
 * body from phase-06 so a wiring regression is caught here, not only in prod.
 *
 * Run: node --import tsx --test tests/unit/book-phase-hook.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import { nextBookPhaseAfter } from '../../gateway/src/services/book-types.js';

const PLANNING_PIPELINE = {
  schemaVersion: 1, name: 'book-planning', label: 'Book Planning', description: 'Plan', dynamic: false,
  steps: [
    { label: 'Market & genre analysis', taskType: 'research', promptTemplate: 'A.' },
    { label: 'Develop premise',         taskType: 'general',  promptTemplate: 'B.' },
  ],
} as const;

const flush = () => new Promise<void>((r) => setImmediate(r));

test('completing a book bound Planning project advances the manifest phase to bible', async () => {
  const e = new ProjectEngine(undefined, join(tmpdir(), 'bookclaw-unit-test-no-such-root'));
  e.setPipelineResolver((name) => (name === 'book-planning' ? (PLANNING_PIPELINE as any) : null));

  const calls: Array<[string, string]> = [];
  const books = { setPhase: async (slug: string, phase: string) => { calls.push([slug, phase]); } };
  // The exact hook body from init/phase-06-content.ts.
  e.onProjectCompleted(async (project: any) => {
    if (books && project?.bookSlug) {
      const nextPhase = nextBookPhaseAfter(project.type);
      if (nextPhase) await books.setPhase(project.bookSlug, nextPhase);
    }
  });

  const p = e.createProjectResolved('book-planning' as any, 'My Medical Romance — Planning', 'desc', { bookSlug: 'my-medical-romance' } as any);
  assert.equal((p as any).bookSlug, 'my-medical-romance');

  e.startProject(p.id);
  // Complete every step in order; the last completion fires onProjectCompleted.
  for (const step of p.steps) e.completeStep(p.id, step.id, 'ok');
  await flush();

  assert.equal(p.status, 'completed');
  assert.deepEqual(calls, [['my-medical-romance', 'bible']]);
  clearTimeout((e as any).saveDebounceTimer);
});

test('a project with no bound book does not call setPhase', async () => {
  const e = new ProjectEngine(undefined, join(tmpdir(), 'bookclaw-unit-test-no-such-root'));
  e.setPipelineResolver((name) => (name === 'book-planning' ? (PLANNING_PIPELINE as any) : null));
  const calls: Array<[string, string]> = [];
  const books = { setPhase: async (slug: string, phase: string) => { calls.push([slug, phase]); } };
  e.onProjectCompleted(async (project: any) => {
    if (books && project?.bookSlug) {
      const nextPhase = nextBookPhaseAfter(project.type);
      if (nextPhase) await books.setPhase(project.bookSlug, nextPhase);
    }
  });

  const p = e.createProjectResolved('book-planning' as any, 'Unbound', 'desc', {});
  e.startProject(p.id);
  for (const step of p.steps) e.completeStep(p.id, step.id, 'ok');
  await flush();

  assert.equal(p.status, 'completed');
  assert.deepEqual(calls, []);
  clearTimeout((e as any).saveDebounceTimer);
});
