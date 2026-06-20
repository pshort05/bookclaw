/**
 * Unit test for the built-in romantasy-planning pipeline (ported from the n8n
 * "Idea to Book Outline - Romantasy V2" workflow). Asserts it is valid pipeline
 * JSON, loads through LibraryService as a builtin, expands with all {{vars}}
 * interpolated, uses only known task types, and produces the four downstream
 * production artifacts (Outline, World Bible, Character Bible, Production Notes)
 * that romantasy-production consumes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parsePipelineJson } from '../../gateway/src/services/book-types.js';
import { expandSteps } from '../../gateway/src/services/pipeline-expand.js';
import { buildPipelineVars } from '../../gateway/src/services/pipeline-vars.js';
import { LibraryService } from '../../gateway/src/services/library.js';

const PIPELINE_PATH = join('library', 'pipelines', 'romantasy-planning.json');
const KNOWN_TASK_TYPES = new Set([
  'general', 'research', 'creative_writing', 'revision', 'style_analysis', 'marketing',
  'outline', 'book_bible', 'consistency', 'final_edit', 'editor_chat', 'prompt_run',
]);

test('romantasy-planning is valid pipeline JSON using only known task types', () => {
  const p = parsePipelineJson(readFileSync(PIPELINE_PATH, 'utf-8'));
  assert.equal(p.schemaVersion, 1);
  const steps = p.steps as any[];
  // The 4 generators and 3 evaluators are wrapped in two `parallel` groups, so
  // flatten members + plain steps to count phases as authored.
  const flat = steps.flatMap((s) => (Array.isArray(s.parallel) ? s.parallel : [s]));
  const ideation = flat.filter((s) => s.phase === 'ideation');
  const selection = flat.filter((s) => s.phase === 'selection');
  assert.equal(ideation.length, 4, 'four concept generators');
  assert.equal(selection.length, 4, 'three evaluators + editor-in-chief');
  assert.ok(flat.every((s) => KNOWN_TASK_TYPES.has(s.taskType)), 'all task types are routable');
});

test('romantasy-planning declares parallel idea + evaluator groups with a single join', () => {
  const p = parsePipelineJson(readFileSync(PIPELINE_PATH, 'utf-8'));
  const steps = p.steps as any[];
  // Two parallel groups at the head: 4 idea generators, then 3 evaluators.
  const groups = steps.filter((s) => Array.isArray(s.parallel));
  assert.equal(groups.length, 2, 'exactly two parallel groups');
  assert.equal(groups[0].parallel.length, 4, 'group 0 = four concept generators');
  assert.equal(groups[1].parallel.length, 3, 'group 1 = three evaluators');

  // The editor-in-chief is an ordinary (non-parallel) step — the implicit join —
  // immediately after the two groups.
  assert.equal(steps[0], groups[0]);
  assert.equal(steps[1], groups[1]);
  assert.ok(!Array.isArray(steps[2].parallel), 'step after the groups is the join, not a group');
  assert.equal(steps[2].label, 'Select Winning Concept (Editor-in-Chief)');

  // Flattening stamps stable g0/g1 markers on the members; the join has none.
  const vars = buildPipelineVars({ title: 'T', description: 'd' });
  const resolved = expandSteps(steps, vars);
  const ideaMembers = resolved.filter((s) => (s as any).parallelGroup === 'g0');
  const evalMembers = resolved.filter((s) => (s as any).parallelGroup === 'g1');
  assert.equal(ideaMembers.length, 4);
  assert.equal(evalMembers.length, 3);
  const editor = resolved.find((s) => s.label === 'Select Winning Concept (Editor-in-Chief)');
  assert.equal((editor as any).parallelGroup, undefined, 'the join carries no group marker');
  // The editor-in-chief join immediately follows the last evaluator.
  const lastEvalIdx = resolved.indexOf(evalMembers[evalMembers.length - 1]);
  assert.equal(resolved.indexOf(editor!), lastEvalIdx + 1, 'editor-in-chief immediately follows the evaluators');
});

test('produces the four production artifacts the production pipeline consumes', () => {
  const p = parsePipelineJson(readFileSync(PIPELINE_PATH, 'utf-8'));
  const labels = (p.steps as any[]).map((s) => s.label);
  for (const artifact of ['World Bible', 'Chapter Outline', 'Character Bible', 'Production Notes']) {
    assert.ok(labels.includes(artifact), `emits a "${artifact}" step`);
  }
});

test('expands with all vars interpolated and the outline pinned to the book chapter count', () => {
  const p = parsePipelineJson(readFileSync(PIPELINE_PATH, 'utf-8'));
  const vars = buildPipelineVars({ title: 'Emberbound', description: 'd', targetChapters: 30, targetWordsPerChapter: 2600 });
  const resolved = expandSteps(p.steps as any[], vars);

  assert.equal(resolved.length, 18, 'no chapter-expand: one resolved step per authored step');
  assert.ok(resolved.every((s) => !/\{\{/.test(s.prompt)), 'no unsubstituted {{vars}} remain');
  const outline = resolved.find((s) => s.label === 'Chapter Outline');
  assert.match(outline!.prompt, /EXACTLY 30 chapters/, 'outline targets the book chapter count');
});

test('loads as a builtin through LibraryService', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-rplan-'));
  try {
    const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;
    // Point the builtin dir at the real repo library so the actual file is loaded.
    const lib = new LibraryService('library', join(root, 'overlay'), fakeSkills);
    await lib.loadAll();
    const entry = lib.get('pipeline', 'romantasy-planning');
    assert.ok(entry, 'pipeline resolves');
    assert.equal(entry!.source, 'builtin');
    assert.equal(entry!.pipeline?.label, 'Romantasy Planning (Idea → Outline + Bibles)');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
