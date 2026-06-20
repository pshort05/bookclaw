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
  // 4 idea generators + 3 evaluators + select-best + the development tail.
  const ideation = steps.filter((s) => s.phase === 'ideation');
  const selection = steps.filter((s) => s.phase === 'selection');
  assert.equal(ideation.length, 4, 'four concept generators');
  assert.equal(selection.length, 4, 'three evaluators + editor-in-chief');
  assert.ok(steps.every((s) => KNOWN_TASK_TYPES.has(s.taskType)), 'all task types are routable');
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
