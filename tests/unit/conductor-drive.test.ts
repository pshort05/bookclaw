/**
 * Unit tests for the Conductor scheduling core (Tier 2/3 feature #6),
 * `gateway/src/services/pipeline/conductor.ts` — the pure bounded DAG
 * supervisor that `index.ts:conductorDrive` drives in production.
 *
 * A FAKE engine (no real AI, no filesystem) stands in for the gateway: each
 * "step" activates synchronously, awaits a small delay, then marks itself
 * completed/failed — mirroring `activateStep` + `startAndRunProject({advance:
 * false})` + `completeStepBare`. We assert on an ordered event log + a live
 * in-flight counter, so the checks are timing-robust.
 *
 * Coverage: bounded concurrency, dependency ordering, failure isolation, FIFO,
 * concurrency clamp, and the legacy pass-through GATE (a project with no
 * `dependsOn` never enters the conductor at all).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runConductor,
  clampConcurrency,
  type ConductorProject,
} from '../../gateway/src/services/pipeline/conductor.js';

interface FakeStep { id: string; status: string; dependsOn?: string[]; }
interface StepCfg { delayMs?: number; fail?: boolean; }
type Event = { id: string; event: 'start' | 'end' };

const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Build a fake `runStep` over a mutable project. Records start/end events and
 * tracks the live in-flight count (so `live.max` proves the concurrency cap).
 * The synchronous prologue flips status to 'active' BEFORE the await, exactly
 * as the real conductorDrive's activateStep does — this is what lets the
 * scheduler's same-tick scan avoid re-picking an in-flight step.
 */
function makeRunStep(project: { status: string; steps: FakeStep[] }, cfg: Record<string, StepCfg>) {
  const events: Event[] = [];
  const live = { cur: 0, max: 0 };
  const runStep = async (stepId: string): Promise<void> => {
    const step = project.steps.find(s => s.id === stepId)!;
    step.status = 'active';                       // activateStep (synchronous)
    live.cur++; live.max = Math.max(live.max, live.cur);
    events.push({ id: stepId, event: 'start' });
    await delay(cfg[stepId]?.delayMs ?? 10);
    events.push({ id: stepId, event: 'end' });
    live.cur--;
    // completeStepBare: mark completed (or failed), then the identical
    // remaining===0 && !hasFailed completion rule.
    step.status = cfg[stepId]?.fail ? 'failed' : 'completed';
    const remaining = project.steps.filter(s => s.status === 'pending' || s.status === 'active');
    const hasFailed = project.steps.some(s => s.status === 'failed');
    if (remaining.length === 0 && !hasFailed) project.status = 'completed';
  };
  return { runStep, events, live };
}

function mkProject(steps: Array<{ id: string; dependsOn?: string[] }>): { status: string; steps: FakeStep[] } {
  return { status: 'active', steps: steps.map(s => ({ id: s.id, status: 'pending', dependsOn: s.dependsOn })) };
}

const idx = (events: Event[], id: string, ev: 'start' | 'end') =>
  events.findIndex(e => e.id === id && e.event === ev);
const started = (events: Event[], id: string) => events.some(e => e.id === id && e.event === 'start');

test('bounded concurrency: never more than the cap in flight', async () => {
  // 6 fully-independent steps, cap 2 → at most 2 run at once, all complete.
  const project = mkProject(['a', 'b', 'c', 'd', 'e', 'f'].map(id => ({ id, dependsOn: [] })));
  const { runStep, live, events } = makeRunStep(project, {});

  await runConductor({
    concurrency: 2,
    getProject: () => project as unknown as ConductorProject,
    isPaused: (p) => p.status === 'paused' || p.status === 'completed',
    runStep,
  });

  assert.equal(live.max, 2, 'peak in-flight must equal the cap of 2');
  assert.equal(project.steps.filter(s => s.status === 'completed').length, 6);
  assert.equal(project.status, 'completed');
  assert.equal(events.filter(e => e.event === 'start').length, 6);
});

test('dependency ordering: a step never starts before its dependsOn complete', async () => {
  // Chain w1 -> w2 -> w3, plus independent x. Cap 2 so x overlaps w1.
  const project = mkProject([
    { id: 'w1', dependsOn: [] },
    { id: 'w2', dependsOn: ['w1'] },
    { id: 'w3', dependsOn: ['w2'] },
    { id: 'x', dependsOn: [] },
  ]);
  const { runStep, events, live } = makeRunStep(project, {});

  await runConductor({
    concurrency: 2,
    getProject: () => project as unknown as ConductorProject,
    isPaused: (p) => p.status === 'paused' || p.status === 'completed',
    runStep,
  });

  // Each dependent starts only after its dep ended.
  assert.ok(idx(events, 'w1', 'end') < idx(events, 'w2', 'start'), 'w2 must wait for w1');
  assert.ok(idx(events, 'w2', 'end') < idx(events, 'w3', 'start'), 'w3 must wait for w2');
  // Independent x parallelized with the chain (proves it is not serialized).
  assert.equal(live.max, 2, 'independent x must run alongside the chain');
  assert.equal(project.status, 'completed');
});

test('failure isolation: a failed step does not abort siblings; its dependents stay blocked', async () => {
  // `bad` fails; `after` depends on it (must never start); `i1`,`i2` independent.
  const project = mkProject([
    { id: 'bad', dependsOn: [] },
    { id: 'after', dependsOn: ['bad'] },
    { id: 'i1', dependsOn: [] },
    { id: 'i2', dependsOn: [] },
  ]);
  const { runStep, events } = makeRunStep(project, { bad: { fail: true } });

  await runConductor({
    concurrency: 2,
    getProject: () => project as unknown as ConductorProject,
    isPaused: (p) => p.status === 'paused' || p.status === 'completed',
    runStep,
  });

  assert.equal(project.steps.find(s => s.id === 'bad')!.status, 'failed');
  assert.equal(project.steps.find(s => s.id === 'after')!.status, 'pending', 'dependent stays blocked');
  assert.ok(!started(events, 'after'), 'blocked dependent must never dispatch');
  // Independent siblings still ran to completion despite the failure.
  assert.equal(project.steps.find(s => s.id === 'i1')!.status, 'completed');
  assert.equal(project.steps.find(s => s.id === 'i2')!.status, 'completed');
  // A hole remains → the project is NOT flipped to completed.
  assert.notEqual(project.status, 'completed');
});

test('FIFO document-order dispatch at cap 1', async () => {
  const project = mkProject(['s1', 's2', 's3'].map(id => ({ id, dependsOn: [] })));
  const { runStep, events } = makeRunStep(project, {});

  await runConductor({
    concurrency: 1,
    getProject: () => project as unknown as ConductorProject,
    isPaused: (p) => p.status === 'paused' || p.status === 'completed',
    runStep,
  });

  assert.deepEqual(
    events.filter(e => e.event === 'start').map(e => e.id),
    ['s1', 's2', 's3'],
    'serial run must follow document order',
  );
});

test('legacy pass-through: a project with no dependsOn never enters the conductor', () => {
  // The gate index.ts applies verbatim. Legacy steps carry no dependsOn field.
  const legacy = mkProject([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  const conductorised = mkProject([{ id: 'a', dependsOn: [] }, { id: 'b', dependsOn: ['a'] }]);

  const gate = (steps: FakeStep[]) => steps.some(s => Array.isArray(s.dependsOn));
  assert.equal(gate(legacy.steps), false, 'legacy project must fail the conductor gate');
  assert.equal(gate(conductorised.steps), true, 'opted-in project must pass the gate');
});

test('concurrency clamp: default 2, floored, bounded to [1,3]', () => {
  assert.equal(clampConcurrency(undefined), 2);
  assert.equal(clampConcurrency(''), 2);
  assert.equal(clampConcurrency('0'), 2);      // non-positive → default
  assert.equal(clampConcurrency('-5'), 2);
  assert.equal(clampConcurrency('nonsense'), 2);
  assert.equal(clampConcurrency('1'), 1);
  assert.equal(clampConcurrency('2'), 2);
  assert.equal(clampConcurrency('3'), 3);
  assert.equal(clampConcurrency('9'), 3);      // clamped high
  assert.equal(clampConcurrency('2.9'), 2);    // floored
});
