/**
 * Unit tests for book-container Phase 3c: ProjectEngine builds a project's Steps
 * from a LibraryPipeline (the book's templates/pipeline.json) instead of the
 * deleted PROJECT_TEMPLATES. Dynamic pipelines delegate to the code generator.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectEngine } from '../../gateway/src/services/projects.js';
import type { LibraryPipeline } from '../../gateway/src/services/library-types.js';

const staticPipeline: LibraryPipeline = {
  schemaVersion: 1,
  name: 'book-planning',
  label: 'Book Planning',
  description: 'd',
  steps: [
    { label: 'Market analysis', skill: 'research', taskType: 'research', promptTemplate: 'Analyze: {{description}} ({{title}})' },
    { label: 'Premise', skill: 'premise', taskType: 'general', promptTemplate: 'Genre is {{genre}}.' },
  ],
};

function engine(): ProjectEngine {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-pj-'));
  return new ProjectEngine(undefined, root);
}

test('createProjectFromPipeline builds Steps from JSON + interpolates context', () => {
  const eng = engine();
  const p = eng.createProjectFromPipeline(staticPipeline, 'My Book', 'a heist story', { genre: 'thriller' });
  assert.equal(p.steps.length, 2);
  assert.equal(p.steps[0].label, 'Market analysis');
  assert.equal(p.steps[0].taskType, 'research');
  assert.match(p.steps[0].prompt, /Analyze: a heist story \(My Book\)/);
  assert.match(p.steps[1].prompt, /Genre is thriller\./);
  assert.equal(p.type, 'book-planning');
});

test('createProjectFromPipeline with dynamic=true delegates to the novel generator', () => {
  const eng = engine();
  const dyn: LibraryPipeline = { schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] };
  const p = eng.createProjectFromPipeline(dyn, 'Epic', 'a saga', { targetChapters: 3, targetWordsPerChapter: 1000, genre: 'fantasy' });
  assert.equal(p.type, 'novel-pipeline');
  assert.ok(p.steps.length > 3, 'generated multiple steps incl. per-chapter');
});

test('createPipeline builds multi-step static phases via the injected resolver (not single-step stubs)', () => {
  const eng = engine();
  // Resolve every static phase to a 2-step pipeline; leave book-production to the code generator.
  eng.setPipelineResolver((name) => ({ ...staticPipeline, name }));
  const { projects } = eng.createPipeline('My Book', 'a heist story', undefined, { targetChapters: 2, targetWordsPerChapter: 500 });

  const staticPhases = projects.filter((p) => p.type !== 'book-production' && p.type !== 'novel-pipeline');
  assert.ok(staticPhases.length >= 4, 'has static phases');
  for (const p of staticPhases) {
    assert.equal(p.steps.length, 2, `${p.type} routed through the pipeline (multi-step), not a single-step stub`);
  }

  const production = projects.find((p) => p.type === 'book-production');
  assert.ok(production, 'book-production phase present');
  assert.ok(production!.steps.length > 2, 'book-production stays code-generated with per-chapter steps');
});

test('createProjectResolved yields a multi-step project when the resolver finds a pipeline', () => {
  const eng = engine();
  eng.setPipelineResolver((name) => ({ ...staticPipeline, name }));
  const p = eng.createProjectResolved('book-launch', 'My Book', 'a heist story', { genre: 'thriller' });
  assert.equal(p.type, 'book-launch', 'project type matches the resolved pipeline name');
  assert.equal(p.steps.length, 2, 'built from the library pipeline (multi-step), not a single-step stub');
});

test('createProjectResolved falls back to a single-step stub when the resolver returns null', () => {
  const eng = engine();
  eng.setPipelineResolver(() => null);
  const p = eng.createProjectResolved('book-launch', 'My Book', 'a heist story');
  assert.equal(p.type, 'book-launch');
  assert.equal(p.steps.length, 1, 'fail-soft single-step fallback');
});

test('createPipeline falls back to single-step stub when resolver returns null', () => {
  const eng = engine();
  eng.setPipelineResolver(() => null);
  const { projects } = eng.createPipeline('My Book', 'a heist story');
  const planning = projects.find((p) => p.type === 'book-planning');
  assert.ok(planning);
  assert.equal(planning!.steps.length, 1, 'fail-soft single-step fallback');
});
