import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

test('createNovelPipeline tags code-generated steps with roles', () => {
  const root = mkdtempSync(join(tmpdir(), 'projects-novel-'));
  const engine = new ProjectEngine(undefined, root);
  const project = engine.createNovelPipeline('Test Novel', 'A test description', { targetChapters: 1 });
  const writeCh1 = project.steps.find((s) => s.label === 'Write Chapter 1');
  assert.equal(writeCh1?.role, 'draft');
  const bibleStep = project.steps.find((s) => s.label === 'Protagonist profile');
  assert.equal(bibleStep?.role, 'bible');
});

test('createBookProduction tags code-generated steps with roles', () => {
  const root = mkdtempSync(join(tmpdir(), 'projects-book-'));
  const engine = new ProjectEngine(undefined, root);
  const project = engine.createBookProduction('Test Novel', 'A test description', { targetChapters: 1 });
  const writeCh1 = project.steps.find((s) => s.label === 'Write Chapter 1');
  assert.equal(writeCh1?.role, 'draft');
});
