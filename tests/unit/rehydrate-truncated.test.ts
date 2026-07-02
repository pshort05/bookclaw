/**
 * Regression test for bug-review finding #18: plot-promise extraction and
 * structure-check read step results directly, but after a restart those are
 * 500-char stubs ending in the truncation marker. rehydrateTruncatedResults —
 * now public so those read routes can call it — must restore the full text from
 * the per-step .md file before the routes consume it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

// The exact marker persistState appends when truncating a result for the state file.
const MARKER = '\n\n[... truncated for state file — full output in project files ...]';

test('rehydrateTruncatedResults restores full step text from the per-step .md (finding 18)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rehydrate-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'rehydrate-data-'));
  const engine: any = new ProjectEngine(undefined, root);
  engine.setDataDirResolver(() => dataDir);

  const fullText = 'FULL CHAPTER ONE TEXT. '.repeat(60); // >500 chars
  writeFileSync(join(dataDir, 'p1-step-1-write-chapter-1.md'), `# Write Chapter 1\n\n${fullText}`);

  const project: any = {
    id: 'p1', title: 'T', bookSlug: null,
    steps: [
      { id: 'p1-step-1', label: 'Write Chapter 1', status: 'completed', result: 'only-a-stub' + MARKER },
    ],
  };

  await engine.rehydrateTruncatedResults(project);

  assert.ok(!project.steps[0].result.includes('truncated for state file'), 'marker gone after rehydration');
  assert.match(project.steps[0].result, /FULL CHAPTER ONE TEXT/, 'full text restored from the .md');
});

test('rehydrateTruncatedResults leaves an already-full result untouched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'rehydrate-'));
  const engine: any = new ProjectEngine(undefined, root);
  const project: any = {
    id: 'p2', title: 'T', steps: [{ id: 'p2-step-1', label: 'X', status: 'completed', result: 'complete result, no marker' }],
  };
  await engine.rehydrateTruncatedResults(project);
  assert.equal(project.steps[0].result, 'complete result, no marker');
});
