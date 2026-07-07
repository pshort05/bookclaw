/**
 * Feature-flow smoke for the visual pipeline builder: exercise the pure
 * transforms + palette factories exactly as the UI drag/click gestures do, and
 * prove a user can BUILD a pipeline from an empty flow and serialize it to the
 * gateway JSON shapes (plain step, {parallel:[...]}, plain step). This is an
 * integration/smoke test over already-shipped pure units (Tasks 1-2), so it
 * passes on first run — there is no artificial RED phase.
 * Run: node --import tsx --test tests/unit/pipeline-builder-flow.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromSteps, toSteps, insertTop, moveIntoGroup, isGroupNode,
} from '../../frontend/studio/src/lib/pipelineEdits.js';
import { nodeFromPalette } from '../../frontend/studio/src/lib/stepPresets.js';

const mkCounter = () => { let i = 0; return () => `k${i++}`; };

test('build a pipeline from the palette → serializes to valid gateway JSON', () => {
  const mk = mkCounter();

  // Start from an empty flow.
  let nodes = fromSteps([], mk);
  assert.equal(nodes.length, 0);

  // Append an "outline" preset (palette card → insertTop at the end).
  const outline = nodeFromPalette({ type: 'preset', key: 'outline' }, mk);
  assert.ok(outline);
  nodes = insertTop(nodes, nodes.length, outline);

  // Append a parallel block, then move two critique presets into it.
  const group = nodeFromPalette({ type: 'block', kind: 'parallel' }, mk);
  assert.ok(group && isGroupNode(group));
  nodes = insertTop(nodes, nodes.length, group);

  const critiqueA = nodeFromPalette({ type: 'preset', key: 'critique' }, mk);
  const critiqueB = nodeFromPalette({ type: 'preset', key: 'critique' }, mk);
  assert.ok(critiqueA && critiqueB);
  // Members are added top-level first, then dragged into the group.
  nodes = insertTop(nodes, nodes.length, critiqueA);
  nodes = moveIntoGroup(nodes, critiqueA.key, group.key);
  nodes = insertTop(nodes, nodes.length, critiqueB);
  nodes = moveIntoGroup(nodes, critiqueB.key, group.key);

  // Append a "final-edit" preset.
  const finalEdit = nodeFromPalette({ type: 'preset', key: 'final-edit' }, mk);
  assert.ok(finalEdit);
  nodes = insertTop(nodes, nodes.length, finalEdit);

  // Serialize back to gateway JSON.
  const steps = toSteps(nodes);
  assert.equal(steps.length, 3);

  // 1: plain outline step
  const first = steps[0] as { taskType?: string };
  assert.equal(first.taskType, 'outline');

  // 2: {parallel:[step, step]} — two critique passes
  const parallel = steps[1] as { parallel?: Array<{ taskType?: string }> };
  assert.ok(Array.isArray(parallel.parallel));
  assert.equal(parallel.parallel!.length, 2);
  assert.deepEqual(parallel.parallel!.map((s) => s.taskType), ['revision', 'revision']);

  // 3: plain final-edit step
  const third = steps[2] as { taskType?: string };
  assert.equal(third.taskType, 'final_edit');
});

test('a group node cannot be moved into another group (nesting rejected)', () => {
  const mk = mkCounter();
  let nodes = fromSteps([], mk);

  const target = nodeFromPalette({ type: 'block', kind: 'parallel' }, mk)!;
  const inner = nodeFromPalette({ type: 'block', kind: 'expand' }, mk)!;
  nodes = insertTop(nodes, nodes.length, target);
  nodes = insertTop(nodes, nodes.length, inner);

  const before = nodes;
  const after = moveIntoGroup(nodes, inner.key, target.key);
  assert.equal(after, before, 'moveIntoGroup returns the input unchanged for a group node');
});
