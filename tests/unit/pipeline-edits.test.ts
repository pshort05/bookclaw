/**
 * Pure-transform tests for the visual pipeline builder's node model
 * (frontend/studio/src/lib/pipelineEdits.ts). Every drag gesture in the studio
 * resolves to one of these functions, so this file is the behavioral contract:
 * round-trip fidelity to the gateway's pipeline JSON shapes, and rejection of
 * invalid moves (groups inside groups).
 * Run: node --import tsx --test tests/unit/pipeline-edits.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fromSteps, toSteps, findByKey, containerOf, indexIn, isGroupNode,
  reorder, insertTop, insertMember, removeByKey, moveIntoGroup, extractFromGroup, patchStep,
} from '../../frontend/studio/src/lib/pipelineEdits.js';
import type { EditorStep } from '../../frontend/studio/src/lib/pipelineSteps.js';

const mkCounter = () => { let i = 0; return () => `k${i++}`; };
const step = (label: string) => ({ label, taskType: 'general', promptTemplate: '' });

const SAMPLE: EditorStep[] = [
  step('a'),
  { parallel: [step('p1'), step('p2')] },
  { expand: 'chapters', steps: [step('c1')] },
  step('z'),
];

test('fromSteps/toSteps round-trips all three shapes', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  assert.equal(nodes.length, 4);
  assert.deepEqual(nodes.map((n) => n.kind), ['step', 'parallel', 'expand', 'step']);
  assert.deepEqual(toSteps(nodes), SAMPLE);
});

test('fromSteps assigns unique keys to every node and member', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const keys = nodes.flatMap((n) => [n.key, ...(isGroupNode(n) ? n.members.map((m) => m.key) : [])]);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(keys.length, 7); // 4 top-level + 3 members
});

test('findByKey resolves top-level nodes and group members', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const par = nodes[1];
  assert.ok(isGroupNode(par));
  const m0 = par.members[0];
  assert.equal(findByKey(nodes, nodes[0].key), nodes[0]);
  assert.equal(findByKey(nodes, m0.key), m0);
  assert.equal(findByKey(nodes, 'nope'), undefined);
});

test('containerOf: top level = undefined, member = group key, missing = null', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const par = nodes[1];
  assert.ok(isGroupNode(par));
  assert.equal(containerOf(nodes, nodes[0].key), undefined);
  assert.equal(containerOf(nodes, par.members[1].key), par.key);
  assert.equal(containerOf(nodes, 'nope'), null);
});

test('indexIn finds position within a container', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const par = nodes[1];
  assert.ok(isGroupNode(par));
  assert.equal(indexIn(nodes, undefined, nodes[3].key), 3);
  assert.equal(indexIn(nodes, par.key, par.members[1].key), 1);
  assert.equal(indexIn(nodes, undefined, 'nope'), -1);
});

test('reorder moves within the top level (arrayMove semantics)', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const out = reorder(nodes, undefined, 0, 2);
  assert.deepEqual(out.map((n) => n.key), [nodes[1].key, nodes[2].key, nodes[0].key, nodes[3].key]);
  assert.equal(reorder(nodes, undefined, 0, 0), nodes); // no-op returns input
  assert.equal(reorder(nodes, undefined, 0, 99), nodes); // out of range
});

test('reorder moves within a group', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const par = nodes[1];
  assert.ok(isGroupNode(par));
  const out = reorder(nodes, par.key, 0, 1);
  const outPar = out[1];
  assert.ok(isGroupNode(outPar));
  assert.deepEqual(outPar.members.map((m) => m.step.label), ['p2', 'p1']);
  assert.deepEqual((nodes[1] as typeof par).members.map((m) => m.step.label), ['p1', 'p2']); // input untouched
});

test('insertTop clamps the index; insertMember targets one group', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const extra = { key: 'new1', kind: 'step' as const, step: step('new') };
  assert.equal(insertTop(nodes, 99, extra).at(-1), extra);
  assert.equal(insertTop(nodes, -5, extra)[0], extra);
  const par = nodes[1];
  assert.ok(isGroupNode(par));
  const out = insertMember(nodes, par.key, 1, extra);
  const outPar = out[1];
  assert.ok(isGroupNode(outPar));
  assert.deepEqual(outPar.members.map((m) => m.step.label), ['p1', 'new', 'p2']);
});

test('removeByKey removes at either level', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const par = nodes[1];
  assert.ok(isGroupNode(par));
  assert.equal(removeByKey(nodes, nodes[0].key).length, 3);
  const out = removeByKey(nodes, par.members[0].key);
  const outPar = out[1];
  assert.ok(isGroupNode(outPar));
  assert.deepEqual(outPar.members.map((m) => m.step.label), ['p2']);
});

test('moveIntoGroup moves a top-level step in (default: append) and rejects groups', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const par = nodes[1];
  const exp = nodes[2];
  assert.ok(isGroupNode(par) && isGroupNode(exp));
  const out = moveIntoGroup(nodes, nodes[0].key, par.key);
  assert.equal(out.length, 3); // 'a' left the top level
  const outPar = out.find((n) => n.key === par.key);
  assert.ok(outPar && isGroupNode(outPar));
  assert.deepEqual(outPar.members.map((m) => m.step.label), ['p1', 'p2', 'a']);
  // a group can never become a member
  assert.equal(moveIntoGroup(nodes, exp.key, par.key), nodes);
});

test('moveIntoGroup also moves a member between groups at an index', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const par = nodes[1];
  const exp = nodes[2];
  assert.ok(isGroupNode(par) && isGroupNode(exp));
  const out = moveIntoGroup(nodes, par.members[0].key, exp.key, 0);
  const outPar = out.find((n) => n.key === par.key);
  const outExp = out.find((n) => n.key === exp.key);
  assert.ok(outPar && isGroupNode(outPar) && outExp && isGroupNode(outExp));
  assert.deepEqual(outPar.members.map((m) => m.step.label), ['p2']);
  assert.deepEqual(outExp.members.map((m) => m.step.label), ['p1', 'c1']);
});

test('extractFromGroup pulls a member to the top level; emptied groups survive', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const exp = nodes[2];
  assert.ok(isGroupNode(exp));
  const out = extractFromGroup(nodes, exp.members[0].key, 0);
  assert.equal(out.length, 5);
  assert.equal((out[0] as { step: { label: string } }).step.label, 'c1');
  const outExp = out.find((n) => n.key === exp.key);
  assert.ok(outExp && isGroupNode(outExp));
  assert.equal(outExp.members.length, 0);
  // an emptied group still serializes (gateway skips empty groups at expand time)
  assert.deepEqual(toSteps(out)[3], { expand: 'chapters', steps: [] });
  // extracting a top-level node is a no-op
  assert.equal(extractFromGroup(nodes, nodes[0].key, 0), nodes);
});

test('patchStep patches at either level without mutating', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const par = nodes[1];
  assert.ok(isGroupNode(par));
  const out = patchStep(nodes, par.members[0].key, { label: 'renamed' });
  const outPar = out[1];
  assert.ok(isGroupNode(outPar));
  assert.equal(outPar.members[0].step.label, 'renamed');
  assert.equal(par.members[0].step.label, 'p1');
  const out2 = patchStep(nodes, nodes[0].key, { taskType: 'revision' });
  assert.equal((out2[0] as { step: { taskType: string } }).step.taskType, 'revision');
});

test('insertMember/removeByKey/patchStep return the input array on no-match', () => {
  const nodes = fromSteps(SAMPLE, mkCounter());
  const extra = { key: 'x', kind: 'step' as const, step: step('x') };
  assert.equal(insertMember(nodes, 'no-such-group', 0, extra), nodes);
  assert.equal(removeByKey(nodes, 'no-such-key'), nodes);
  assert.equal(patchStep(nodes, 'no-such-key', { label: 'z' }), nodes);
});
