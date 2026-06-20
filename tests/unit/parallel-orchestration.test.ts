/**
 * Unit tests for ProjectEngine's parallel-group orchestration — fan-out + the
 * implicit join barrier — driven WITHOUT any real AI (modelled on
 * project-engine-orchestration.test.ts). A pipeline carrying a `{ parallel:[...] }`
 * group followed by an ordinary step fans out all members at start and gates the
 * join until every member completes.
 *
 * Run: node --import tsx --test tests/unit/parallel-orchestration.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectEngine } from '../../gateway/src/services/projects.js';

function makeEngine(): ProjectEngine {
  return new ProjectEngine(undefined, join(tmpdir(), 'bookclaw-unit-test-no-such-root'));
}

// A pipeline: a 3-member parallel group, then a single ordinary join step.
const PARALLEL_PIPELINE = {
  schemaVersion: 1,
  name: 'parallel-plan',
  label: 'Parallel Plan',
  description: 'fan out then join',
  dynamic: false,
  steps: [
    { parallel: [
      { label: 'Member 1', taskType: 'creative_writing', promptTemplate: 'm1' },
      { label: 'Member 2', taskType: 'creative_writing', promptTemplate: 'm2' },
      { label: 'Member 3', taskType: 'creative_writing', promptTemplate: 'm3' },
    ] },
    { label: 'Join', taskType: 'revision', promptTemplate: 'join all' },
  ],
} as const;

function makeParallelProject(e: ProjectEngine) {
  e.setPipelineResolver((name) => (name === 'parallel-plan' ? (PARALLEL_PIPELINE as any) : null));
  return e.createProjectResolved('parallel-plan' as any, 'My Plan', 'desc', {});
}

function quiesce(e: ProjectEngine): void {
  clearTimeout((e as any).saveDebounceTimer);
}

const memberIds = (p: any) => p.steps.filter((s: any) => s.parallelGroup === 'g0').map((s: any) => s.id);
const joinStep = (p: any) => p.steps.find((s: any) => !s.parallelGroup);

test('the project is built with 3 grouped members + 1 ungrouped join', () => {
  const e = makeEngine();
  const p = makeParallelProject(e);
  assert.equal(p.steps.length, 4);
  assert.deepEqual(p.steps.map((s: any) => s.parallelGroup), ['g0', 'g0', 'g0', undefined]);
  assert.equal(joinStep(p).label, 'Join');
  quiesce(e);
});

test('startProject fans out all members of the leading parallel group, join stays pending', () => {
  const e = makeEngine();
  const p = makeParallelProject(e);

  const first = e.startProject(p.id);
  assert.ok(first, 'startProject returns the first member');
  // All three members are now active; the join is still pending.
  const statuses = p.steps.map((s: any) => s.status);
  assert.deepEqual(statuses, ['active', 'active', 'active', 'pending']);
  assert.equal(p.status, 'active');
  quiesce(e);
});

test('the join step stays pending until every group member completes (barrier)', () => {
  const e = makeEngine();
  const p = makeParallelProject(e);
  e.startProject(p.id);
  const [m1, m2, m3] = memberIds(p);
  const join = joinStep(p);

  // Complete member 1 → no new ordinary step; join still pending.
  const after1 = e.completeStep(p.id, m1, 'r1');
  assert.equal(join.status, 'pending', 'join not yet open after member 1');
  // The returned "next" is a still-runnable sibling (active member), not the join.
  if (after1) assert.notEqual(after1.id, join.id, 'never the join while members remain');
  assert.notEqual(p.status, 'completed');

  // Complete member 2 → still gated.
  e.completeStep(p.id, m2, 'r2');
  assert.equal(join.status, 'pending', 'join not yet open after member 2');
  assert.notEqual(p.status, 'completed');

  // Complete the last member → the join opens and is returned as next.
  const next = e.completeStep(p.id, m3, 'r3');
  assert.ok(next, 'completing the last member surfaces the join');
  assert.equal(next!.id, join.id);
  assert.equal(next!.status, 'active');
  assert.notEqual(p.status, 'completed', 'project not done until the join completes');

  // Completing the join finishes the project.
  const done = e.completeStep(p.id, join.id, 'final');
  assert.equal(done, null);
  assert.equal(p.status, 'completed');
  assert.equal(p.progress, 100);
  quiesce(e);
});

test('a failed group member halts at the barrier and retry reopens it', () => {
  const e = makeEngine();
  const p = makeParallelProject(e);
  e.startProject(p.id);
  const [m1, m2, m3] = memberIds(p);
  const join = joinStep(p);

  e.completeStep(p.id, m1, 'r1');
  e.completeStep(p.id, m2, 'r2');
  e.failStep(p.id, m3, 'boom');

  // The join must NOT open while a member is failed; project is not completed.
  assert.equal(p.steps.find((s: any) => s.id === m3).status, 'failed');
  assert.equal(join.status, 'pending', 'join stays gated behind a failed member');
  assert.notEqual(p.status, 'completed');

  // Retry the failed member → back to pending/runnable.
  const retried = e.retryStep(p.id, m3);
  assert.ok(retried);
  assert.equal(p.steps.find((s: any) => s.id === m3).status, 'pending');
  assert.equal(join.status, 'pending', 'join still gated until the retried member completes');

  // Complete it → the join opens.
  const next = e.completeStep(p.id, m3, 'r3-retry');
  assert.ok(next);
  assert.equal(next!.id, join.id);
  assert.equal(next!.status, 'active');
  quiesce(e);
});

test('resumeProject re-fans-out all pending members of a mid-flight group', () => {
  const e = makeEngine();
  const p = makeParallelProject(e);
  e.startProject(p.id);                 // all 3 members active
  const [m1, m2, m3] = memberIds(p);
  e.completeStep(p.id, m1, 'r1');       // m1 done; m2, m3 active

  e.pauseProject(p.id);                 // reverts m2, m3 to pending
  assert.deepEqual([m2, m3].map((id) => p.steps.find((s: any) => s.id === id).status), ['pending', 'pending']);

  const resumed = e.resumeProject(p.id);
  // Both remaining members re-activate together (not just one).
  assert.deepEqual(resumed.map((s) => s.id).sort(), [m2, m3].sort());
  assert.deepEqual([m2, m3].map((id) => p.steps.find((s: any) => s.id === id).status), ['active', 'active']);
  assert.equal(joinStep(p).status, 'pending', 'join still gated');
  quiesce(e);
});

// ─── Priority A: adjacent-groups barrier bug ────────────────────────────────
// Pipeline: g0 (4 members) then g1 (3 members) then an ordinary join.
// Bug (pre-fix): once the first g0 member completes, runnableSteps uses
// find(pending) which skips the still-ACTIVE g0 siblings and lands on g1[0],
// fanning out g1 before g0 is done. Fix: frontier is first non-done step
// (pending OR active), and a group's pending members are only runnable if
// every EARLIER group is groupComplete.
const TWO_GROUP_PIPELINE = {
  schemaVersion: 1,
  name: 'two-groups',
  label: 'Two Groups',
  description: 'g0 then g1 then join',
  dynamic: false,
  steps: [
    { parallel: [
      { label: 'G0-A', taskType: 'creative_writing', promptTemplate: 'g0a' },
      { label: 'G0-B', taskType: 'creative_writing', promptTemplate: 'g0b' },
      { label: 'G0-C', taskType: 'creative_writing', promptTemplate: 'g0c' },
      { label: 'G0-D', taskType: 'creative_writing', promptTemplate: 'g0d' },
    ] },
    { parallel: [
      { label: 'G1-A', taskType: 'revision', promptTemplate: 'g1a' },
      { label: 'G1-B', taskType: 'revision', promptTemplate: 'g1b' },
      { label: 'G1-C', taskType: 'revision', promptTemplate: 'g1c' },
    ] },
    { label: 'Editor Join', taskType: 'revision', promptTemplate: 'join all' },
  ],
} as const;

test('adjacent groups: g1 does NOT fan out while any g0 member is still active', () => {
  const e = makeEngine();
  e.setPipelineResolver((name) => (name === 'two-groups' ? (TWO_GROUP_PIPELINE as any) : null));
  const p = e.createProjectResolved('two-groups' as any, 'T', 'd', {});

  e.startProject(p.id);
  // g0: all 4 active; g1: all 3 pending; join: pending
  assert.deepEqual(p.steps.map((s: any) => s.parallelGroup), ['g0','g0','g0','g0','g1','g1','g1', undefined]);
  const [g0a, g0b, g0c, g0d] = p.steps.filter((s: any) => s.parallelGroup === 'g0').map((s: any) => s.id);
  const g1members = p.steps.filter((s: any) => s.parallelGroup === 'g1');
  assert.deepEqual(p.steps.map((s: any) => s.status), ['active','active','active','active','pending','pending','pending','pending']);

  // Complete g0a: g0b/g0c/g0d still active → g1 must NOT activate.
  e.completeStep(p.id, g0a, 'r0a');
  assert.deepEqual(g1members.map((s: any) => s.status), ['pending','pending','pending'], 'g1 still gated while g0 in-flight');

  // Complete g0b.
  e.completeStep(p.id, g0b, 'r0b');
  assert.deepEqual(g1members.map((s: any) => s.status), ['pending','pending','pending'], 'g1 still gated');

  // Complete g0c.
  e.completeStep(p.id, g0c, 'r0c');
  assert.deepEqual(g1members.map((s: any) => s.status), ['pending','pending','pending'], 'g1 still gated until all g0 done');

  // Complete the last g0 member → NOW g1 may fan out.
  e.completeStep(p.id, g0d, 'r0d');
  assert.deepEqual(g1members.map((s: any) => s.status), ['active','active','active'], 'g1 fans out once g0 is fully complete');

  // The join must remain pending while g1 is in-flight.
  const join = p.steps.find((s: any) => !s.parallelGroup);
  assert.equal(join.status, 'pending', 'join gated behind g1');
  quiesce(e);
});

// ─── Priority B: activeFrontier helper ──────────────────────────────────────

test('activeFrontier returns all active members of the frontier parallel group', () => {
  const e = makeEngine();
  const p = makeParallelProject(e);
  e.startProject(p.id);  // all 3 g0 members active
  const [m1, m2, m3] = memberIds(p);

  const frontier = e.activeFrontier(p.id);
  // All 3 active members are returned.
  assert.deepEqual(frontier.map((s: any) => s.id).sort(), [m1, m2, m3].sort());
  assert.ok(frontier.every((s: any) => s.status === 'active'));

  // After completing one, the remaining two are still the frontier.
  e.completeStep(p.id, m1, 'r1');
  const frontier2 = e.activeFrontier(p.id);
  assert.deepEqual(frontier2.map((s: any) => s.id).sort(), [m2, m3].sort());
  quiesce(e);
});

test('activeFrontier returns just the one active step for a no-parallel project', () => {
  const e = makeEngine();
  e.setPipelineResolver((name) => (name === 'plain2' ? ({
    schemaVersion: 1, name: 'plain2', label: 'Plain2', description: 'd', dynamic: false,
    steps: [
      { label: 'S1', taskType: 'general', promptTemplate: 'a' },
      { label: 'S2', taskType: 'general', promptTemplate: 'b' },
    ],
  } as any) : null));
  const p = e.createProjectResolved('plain2' as any, 'T', 'd', {});
  e.startProject(p.id);  // S1 active, S2 pending

  const frontier = e.activeFrontier(p.id);
  assert.equal(frontier.length, 1, 'exactly one step in frontier');
  assert.equal(frontier[0].id, p.steps[0].id);
  assert.equal(frontier[0].status, 'active');
  quiesce(e);
});

test('activeFrontier returns [] before startProject is called', () => {
  const e = makeEngine();
  const p = makeParallelProject(e);
  assert.deepEqual(e.activeFrontier(p.id), []);
  quiesce(e);
});

test('resumeProject re-activates exactly the one next step for a no-parallel project (backward compat)', () => {
  const e = makeEngine();
  e.setPipelineResolver((name) => (name === 'plain' ? ({
    schemaVersion: 1, name: 'plain', label: 'Plain', description: 'd', dynamic: false,
    steps: [
      { label: 'S1', taskType: 'general', promptTemplate: 'a' },
      { label: 'S2', taskType: 'general', promptTemplate: 'b' },
    ],
  } as any) : null));
  const p = e.createProjectResolved('plain' as any, 'T', 'd', {});
  e.startProject(p.id);
  e.pauseProject(p.id);                 // S1 reverts to pending
  const resumed = e.resumeProject(p.id);
  assert.equal(resumed.length, 1, 'one runnable step');
  assert.equal(resumed[0].id, p.steps[0].id);
  assert.equal(p.steps[0].status, 'active');
  assert.equal(p.steps[1].status, 'pending');
  quiesce(e);
});
