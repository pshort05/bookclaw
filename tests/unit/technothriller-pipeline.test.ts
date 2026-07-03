/**
 * Flagship Plan 7, Task 2: the built-in technothriller-planning and
 * technothriller-production pipelines (adapted from the MSF phase shape).
 * Asserts both are valid pipeline JSON, every nested step carries a valid
 * `role`, the production loop uses `expand: chapters`, and both load through
 * the REAL LibraryService (same path a live book uses) alongside the
 * `technothriller` sequence that chains them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parsePipelineJson } from '../../gateway/src/services/book-types.js';
import { expandSteps } from '../../gateway/src/services/pipeline-expand.js';
import { buildPipelineVars } from '../../gateway/src/services/pipeline-vars.js';
import { LibraryService } from '../../gateway/src/services/library.js';
import { isStepRole } from '../../gateway/src/services/casting/roles.js';

const PLANNING_PATH = join('library', 'pipelines', 'technothriller-planning.json');
const PRODUCTION_PATH = join('library', 'pipelines', 'technothriller-production.json');
const KNOWN_TASK_TYPES = new Set([
  'general', 'research', 'creative_writing', 'revision', 'style_analysis', 'marketing',
  'outline', 'book_bible', 'consistency', 'final_edit', 'editor_chat', 'prompt_run',
]);

function flatten(steps: any[]): any[] {
  return steps.flatMap((s) => (Array.isArray(s.parallel) ? s.parallel : Array.isArray(s.steps) ? s.steps : [s]));
}

test('technothriller-planning is valid pipeline JSON, every step has a valid role and a known task type', () => {
  const p = parsePipelineJson(readFileSync(PLANNING_PATH, 'utf-8'));
  assert.equal(p.schemaVersion, 1);
  const steps = flatten(p.steps as any[]);
  assert.ok(steps.length >= 5, 'a research-heavy planning pipeline with several artifacts');
  for (const s of steps) {
    assert.ok(isStepRole(s.role) || s.phase === 'assembly', `step "${s.label}" needs a valid role (or is the assembly/compile step)`);
    assert.ok(KNOWN_TASK_TYPES.has(s.taskType), `step "${s.label}" has an unknown taskType "${s.taskType}"`);
  }
  const labels = steps.map((s) => s.label);
  for (const artifact of ['Chapter Outline — Tension Structure', 'Technology & Institutional Dossier', 'Character Bible', 'Production Notes']) {
    assert.ok(labels.includes(artifact), `emits a "${artifact}" step`);
  }
});

test('technothriller-planning expands with all vars interpolated', () => {
  const p = parsePipelineJson(readFileSync(PLANNING_PATH, 'utf-8'));
  const vars = buildPipelineVars({ title: 'Cascade Point', description: 'd', targetChapters: 28, targetWordsPerChapter: 3200 });
  const resolved = expandSteps(p.steps as any[], vars);
  assert.ok(resolved.every((s) => !/\{\{/.test(s.prompt)), 'no unsubstituted {{vars}} remain');
  const outline = resolved.find((s) => s.label === 'Chapter Outline — Tension Structure');
  assert.match(outline!.prompt, /28 chapters/);
});

test('technothriller-production is valid pipeline JSON with a role-tagged chapter-expand block', () => {
  const p = parsePipelineJson(readFileSync(PRODUCTION_PATH, 'utf-8'));
  assert.equal(p.schemaVersion, 1);
  const expand = (p.steps as any[]).find((s) => s.expand === 'chapters');
  assert.ok(expand, 'production loop uses expand: chapters');
  assert.ok(Array.isArray(expand.steps) && expand.steps.length >= 5, 'brief -> draft -> improve -> rewrite -> humanize (-> continuity)');
  for (const s of expand.steps) {
    assert.ok(isStepRole(s.role), `per-chapter step "${s.label}" needs a valid role, got "${s.role}"`);
    assert.ok(KNOWN_TASK_TYPES.has(s.taskType), `step "${s.label}" has an unknown taskType "${s.taskType}"`);
  }
  const roles = expand.steps.map((s: any) => s.role);
  assert.deepEqual(roles, ['scene_brief', 'draft', 'improve', 'rewrite', 'humanize', 'continuity']);
});

test('technothriller-production expands to per-chapter steps plus a compile step, fully interpolated', () => {
  const p = parsePipelineJson(readFileSync(PRODUCTION_PATH, 'utf-8'));
  const vars = buildPipelineVars({ title: 'Cascade Point', description: 'd', targetChapters: 3, targetWordsPerChapter: 2600 });
  const resolved = expandSteps(p.steps as any[], vars);
  assert.equal(resolved.length, 3 * 6 + 1, '3 chapters x 6 stages + compile');
  assert.ok(resolved.every((s) => !/\{\{/.test(s.prompt)), 'no unsubstituted {{vars}} remain');
  const ch2 = resolved.filter((s) => s.chapterNumber === 2);
  assert.equal(ch2.length, 6, 'chapter 2 has all six stages');
  const draft = resolved.find((s) => s.label === 'First Draft — Chapter 1');
  assert.equal(draft?.wordCountTarget, 2600);
});

test('loads both technothriller pipelines and the technothriller sequence through the real LibraryService', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-tt-'));
  try {
    const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;
    // Point the builtin dir at the real repo library so the actual shipped files load.
    const lib = new LibraryService('library', join(root, 'overlay'), fakeSkills);
    await lib.loadAll();

    const planning = lib.get('pipeline', 'technothriller-planning');
    assert.ok(planning, 'technothriller-planning resolves');
    assert.equal(planning!.source, 'builtin');

    const production = lib.get('pipeline', 'technothriller-production');
    assert.ok(production, 'technothriller-production resolves');
    assert.equal(production!.source, 'builtin');

    const seq = lib.get('sequence', 'technothriller');
    assert.ok(seq, 'technothriller sequence resolves');
    assert.deepEqual(seq!.sequence?.pipelines, ['technothriller-planning', 'technothriller-production']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
