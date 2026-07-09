/**
 * Output-hygiene guard for the hardcoded novel-pipeline (2026-07-08): every
 * canon/bible/outline/analysis step must carry an output contract, while the
 * assembly report step must NOT be forced to "no commentary" (its commentary is
 * the deliverable). Complements the library-pipeline guard
 * (pipeline-output-contract.test.ts) for the code-generated pipeline.
 *
 * Run: node --import tsx --test tests/unit/novel-pipeline-contract.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

test('novel-pipeline: canon/outline steps carry an output contract; report step does not', () => {
  const engine = new ProjectEngine();
  const project = engine.createNovelPipeline('Guard Book', 'A test premise.', {
    targetChapters: 2,
    wordsPerChapter: 500,
  });
  const CONTRACT = /output only the requested document|no commentary/i;

  const bible = project.steps.find((s) => s.label === 'Protagonist profile');
  const outline = project.steps.find((s) => s.label === 'Chapter outline');
  const report = project.steps.find((s) => s.phase === 'assembly');
  assert.ok(bible && CONTRACT.test(bible.prompt), 'bible step has an output contract');
  assert.ok(outline && CONTRACT.test(outline.prompt), 'outline step has an output contract');
  assert.ok(report && !CONTRACT.test(report.prompt), 'report step is NOT forced to no-commentary');

  // A chapter (writing) step is contracted via writeChapterPrompt, not the append.
  const chapter = project.steps.find((s) => s.phase === 'writing');
  assert.ok(chapter && /prose only/i.test(chapter.prompt), 'chapter step forbids commentary');
});
