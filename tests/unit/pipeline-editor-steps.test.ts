/**
 * Regression test for blank pipeline-step rows in the studio Library editor.
 * The PipelineEditor renders three step shapes: plain steps (label + taskType),
 * {expand:'chapters'} groups, and {parallel:[...]} groups. A shape the editor's
 * guards don't recognize falls through to the plain-step row and renders blank
 * (undefined label, no pills) — which is how parallel groups appeared before
 * isParallel existed. Assert every top-level entry of every built-in pipeline
 * classifies as a renderable shape with visible header content.
 * Run: node --import tsx --test tests/unit/pipeline-editor-steps.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isExpand, isParallel, type EditorStep } from '../../frontend/studio/src/lib/pipelineSteps.js';

const dir = join(process.cwd(), 'library/pipelines');

test('every built-in pipeline step renders a non-blank editor row', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0, 'built-in pipelines present');
  for (const file of files) {
    const pipeline = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
    if (pipeline.dynamic) continue; // steps generated at create-time, not rendered by the editor
    const steps: EditorStep[] = pipeline.steps ?? [];
    steps.forEach((entry, i) => {
      const where = `${file} step ${i + 1}`;
      if (isExpand(entry)) {
        assert.ok(entry.steps.length > 0, `${where}: expand group has sub-steps`);
      } else if (isParallel(entry)) {
        assert.ok(entry.parallel.length > 0, `${where}: parallel group has members`);
      } else {
        // Plain step: the collapsed row shows label + taskType — both must exist
        // or the row renders blank in the Library editor.
        assert.ok(typeof entry.label === 'string' && entry.label.trim(), `${where}: plain step has a label`);
        assert.ok(typeof entry.taskType === 'string' && entry.taskType.trim(), `${where}: plain step has a taskType`);
      }
    });
  }
});
