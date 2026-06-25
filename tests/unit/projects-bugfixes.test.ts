/**
 * Unit tests for ProjectEngine bug fixes:
 *
 *  - BUG H2: skipStep must be parallel-group aware — skipping one member of an
 *    in-flight parallel group while a sibling is still active must NOT complete
 *    the project.
 *  - BUG M6: a step result persisted truncated (with the truncation marker) must
 *    be re-hydrated from its full per-step .md output on disk before context is
 *    built; missing file => keep the truncated value (fail-soft).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

function engine(): { eng: ProjectEngine; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-projbug-'));
  return { eng: new ProjectEngine(undefined, root), root };
}

test('BUG H2: skipping one parallel-group member while a sibling is active does NOT complete the project', () => {
  const { eng } = engine();
  const project = eng.createProject('custom' as any, 'Parallel Skip', 'desc');

  // Build a 2-member parallel group + a trailing join step. Member A is active
  // (in-flight), member B is pending; the user skips B.
  project.steps = [
    { id: 'a', label: 'Member A', taskType: 'general' as any, prompt: 'x', status: 'active', parallelGroup: 'g1' },
    { id: 'b', label: 'Member B', taskType: 'general' as any, prompt: 'x', status: 'pending', parallelGroup: 'g1' },
    { id: 'join', label: 'Join', taskType: 'general' as any, prompt: 'x', status: 'pending' },
  ];
  project.status = 'active';

  const next = eng.skipStep(project.id, 'b');

  const after = eng.getProject(project.id)!;
  assert.notEqual(after.status, 'completed', 'project must NOT be marked completed while A is still active');
  // Member A stays active; the join must not be activated yet (group not drained).
  assert.equal(after.steps.find(s => s.id === 'a')!.status, 'active');
  assert.equal(after.steps.find(s => s.id === 'b')!.status, 'skipped');
  assert.equal(after.steps.find(s => s.id === 'join')!.status, 'pending');
  // skipStep falls back to the still-active sibling rather than returning null.
  assert.equal(next?.id, 'a');
});

test('BUG H2: skipping the final remaining step completes the project (no regression)', () => {
  const { eng } = engine();
  const project = eng.createProject('custom' as any, 'Last Skip', 'desc');
  project.steps = [
    { id: 'only', label: 'Only', taskType: 'general' as any, prompt: 'x', status: 'active' },
  ];
  project.status = 'active';

  const next = eng.skipStep(project.id, 'only');
  assert.equal(next, null);
  assert.equal(eng.getProject(project.id)!.status, 'completed');
});

test('BUG M6: a truncated step result is re-hydrated from its full .md output on disk', async () => {
  const { eng, root } = engine();
  const project = eng.createProject('custom' as any, 'Hydrate Me', 'desc');

  const stepId = 'step-write';
  const label = 'Write Chapter 1';
  const full = 'FULL OUTPUT '.repeat(200); // > 500 chars
  const truncated = full.substring(0, 500) +
    '\n\n[... truncated for state file — full output in project files ...]';

  // Step carries a truncated result (simulating a post-restart load).
  project.steps = [
    { id: stepId, label, taskType: 'general' as any, prompt: 'x', status: 'completed', result: truncated },
    { id: 'next', label: 'Next', taskType: 'general' as any, prompt: 'x', status: 'active' },
  ];

  // Write the full per-step output where the legacy resolver looks:
  // workspace/projects/<projectTitleSlug>/<stepId>-<labelSlug>.md, with a heading.
  const projectSlug = project.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dataDir = join(root, 'workspace', 'projects', projectSlug);
  mkdirSync(dataDir, { recursive: true });
  const filename = `${stepId}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
  writeFileSync(join(dataDir, filename), `# ${label}\n\n${full}`, 'utf-8');

  await eng.buildProjectContext(project, project.steps[1]);

  const hydrated = eng.getProject(project.id)!.steps.find(s => s.id === stepId)!;
  assert.equal(hydrated.result, full, 'truncated result should be replaced by the full disk output');
});

test('BUG M6: missing output file keeps the truncated value (fail-soft)', async () => {
  const { eng } = engine();
  const project = eng.createProject('custom' as any, 'No File', 'desc');
  const truncated = 'x'.repeat(500) +
    '\n\n[... truncated for state file — full output in project files ...]';
  project.steps = [
    { id: 's1', label: 'S1', taskType: 'general' as any, prompt: 'x', status: 'completed', result: truncated },
    { id: 'next', label: 'Next', taskType: 'general' as any, prompt: 'x', status: 'active' },
  ];

  await eng.buildProjectContext(project, project.steps[1]);

  const after = eng.getProject(project.id)!.steps.find(s => s.id === 's1')!;
  assert.equal(after.result, truncated, 'no file on disk => keep the truncated value');
});
