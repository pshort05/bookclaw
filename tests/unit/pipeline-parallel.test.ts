/**
 * Unit tests for parallel-group flattening in pipeline-expand.ts.
 *
 * A pipeline steps[] may carry a `{ parallel: [member, ...] }` wrapper entry
 * (mirroring the existing `{ expand:'chapters', steps:[...] }` group). expandSteps
 * flattens each member through the same per-step interpolation as a plain step and
 * stamps a stable, index-based `parallelGroup` marker ('g'+entryIndex). The next
 * ordinary step after a group is the implicit join (no marker).
 *
 * Run: node --import tsx --test tests/unit/pipeline-parallel.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPipelineVars } from '../../gateway/src/services/pipeline-vars.ts';
import { expandSteps } from '../../gateway/src/services/pipeline-expand.ts';

test('expandSteps flattens a parallel group with stable g<index> markers', () => {
  const vars = buildPipelineVars({ title: 'Book', description: 'D' });
  const raw = [
    { parallel: [
      { label: 'Idea A {{title}}', taskType: 'creative_writing', phase: 'ideation', wordCountTarget: 500, promptTemplate: 'A for {{title}}' },
      { label: 'Idea B {{title}}', taskType: 'creative_writing', phase: 'ideation', promptTemplate: 'B for {{title}}' },
      { label: 'Idea C {{title}}', taskType: 'creative_writing', phase: 'ideation', promptTemplate: 'C for {{title}}' },
    ] },
    { label: 'Join', taskType: 'revision', phase: 'selection', promptTemplate: 'Read all ideas.' },
  ];
  const out = expandSteps(raw as any, vars);
  assert.equal(out.length, 4, '3 members + 1 join');
  assert.deepEqual(out.map((s) => (s as any).parallelGroup), ['g0', 'g0', 'g0', undefined]);
  // member fields interpolate + emitStep-copied fields are preserved
  assert.deepEqual(out.slice(0, 3).map((s) => s.label), ['Idea A Book', 'Idea B Book', 'Idea C Book']);
  assert.equal(out[0].prompt, 'A for Book');
  assert.equal(out[0].taskType, 'creative_writing');
  assert.equal(out[0].wordCountTarget, 500);
  // the join is an ordinary step with no marker
  assert.equal((out[3] as any).parallelGroup, undefined);
  assert.equal(out[3].label, 'Join');
});

test('two parallel groups get distinct g<index> ids derived from array position', () => {
  const vars = buildPipelineVars({ title: 'T', description: 'D' });
  const raw = [
    { parallel: [
      { label: 'A', taskType: 'creative_writing', promptTemplate: 'a' },
      { label: 'B', taskType: 'creative_writing', promptTemplate: 'b' },
    ] },
    { parallel: [
      { label: 'C', taskType: 'revision', promptTemplate: 'c' },
      { label: 'D', taskType: 'revision', promptTemplate: 'd' },
    ] },
    { label: 'Join', taskType: 'final_edit', promptTemplate: 'join' },
  ];
  const out = expandSteps(raw as any, vars);
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((s) => (s as any).parallelGroup), ['g0', 'g0', 'g1', 'g1', undefined]);
});

test('a malformed parallel group is skipped, not emitted', () => {
  const vars = buildPipelineVars({ title: 'T', description: 'D' });
  const raw = [
    { parallel: [] },          // empty
    { parallel: 'x' },         // not an array
    { label: 'Real', taskType: 'general', promptTemplate: 'ok' },
  ];
  const out = expandSteps(raw as any, vars);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, 'Real');
  assert.equal((out[0] as any).parallelGroup, undefined);
});

test('a no-parallel pipeline produces no parallelGroup markers (backward compat)', () => {
  const vars = buildPipelineVars({ title: 'T', description: 'D' });
  const raw = [
    { label: 'One', taskType: 'outline', promptTemplate: 'one' },
    { label: 'Two', taskType: 'creative_writing', promptTemplate: 'two' },
    { label: 'Three', taskType: 'general', promptTemplate: 'three' },
  ];
  const out = expandSteps(raw as any, vars);
  assert.equal(out.length, 3);
  assert.ok(out.every((s) => (s as any).parallelGroup === undefined));
  assert.deepEqual(out.map((s) => s.label), ['One', 'Two', 'Three']);
});
