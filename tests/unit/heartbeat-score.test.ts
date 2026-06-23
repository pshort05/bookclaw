/**
 * Unit tests for gateway/src/services/heartbeat.ts — the pure project-priority
 * scoring (`scoreProject`) plus the autonomous wake/selection loop, both driven
 * with injected callbacks so the tests stay fully network-free.
 *
 * `scoreProject` is reached via a thin test subclass (the production method was
 * relaxed from `private` to `protected` purely to expose it here — no behavior
 * change). The wake loop is exercised through the public `enableAutonomous()` /
 * injected `setAutonomous(...)` seam plus `getJournal()` to observe which
 * project was selected and whether the idle task fired.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeartbeatService } from '../../gateway/src/services/heartbeat.js';

// MemoryService is stored but never touched by the scoring/selection paths under
// test, so a bare stub cast through `unknown` is enough.
const memoryStub = {} as never;

/** Subclass that surfaces the protected scoreProject for direct table testing. */
class TestableHeartbeat extends HeartbeatService {
  scoreOf(project: { status: string; progressNum: number; type: string; stepsRemaining: number }): number {
    return this.scoreProject(project);
  }
}

function makeProject(over: Partial<{ status: string; progressNum: number; type: string; stepsRemaining: number }> = {}) {
  return {
    status: 'active',
    progressNum: 0,
    type: 'novel-pipeline',
    stepsRemaining: 10,
    ...over,
  };
}

// ── scoreProject(): table of the additive priority rules ────────────────────

test('scoreProject: a fresh active non-pipeline project scores only the active bonus', () => {
  const hb = new TestableHeartbeat({}, memoryStub);
  // active(+100), progress 0 (no boosts), type 'short' (no pipeline boost),
  // stepsRemaining 10 (> 3, no near-finish boost) → 100.
  assert.equal(hb.scoreOf(makeProject({ type: 'short', progressNum: 0, stepsRemaining: 10 })), 100);
});

test('scoreProject: a pending project gets no active bonus', () => {
  const hb = new TestableHeartbeat({}, memoryStub);
  // not active (0), pipeline(+10), progress 0, steps 10 → 10.
  assert.equal(hb.scoreOf(makeProject({ status: 'pending', progressNum: 0, stepsRemaining: 10 })), 10);
});

test('scoreProject: active always outranks pending, all else equal', () => {
  const hb = new TestableHeartbeat({}, memoryStub);
  const active = hb.scoreOf(makeProject({ status: 'active' }));
  const pending = hb.scoreOf(makeProject({ status: 'pending' }));
  assert.ok(active > pending, `active ${active} should beat pending ${pending}`);
});

test('scoreProject: novel-pipeline gets a +10 boost over other types', () => {
  const hb = new TestableHeartbeat({}, memoryStub);
  const pipeline = hb.scoreOf(makeProject({ type: 'novel-pipeline' }));
  const other = hb.scoreOf(makeProject({ type: 'short' }));
  assert.equal(pipeline - other, 10);
});

test('scoreProject: progress > 50 adds +20, and > 75 stacks another +15', () => {
  const hb = new TestableHeartbeat({}, memoryStub);
  const base = makeProject({ type: 'short', progressNum: 10, stepsRemaining: 10 }); // 100
  const over50 = makeProject({ type: 'short', progressNum: 60, stepsRemaining: 10 }); // 100+20
  const over75 = makeProject({ type: 'short', progressNum: 80, stepsRemaining: 10 }); // 100+20+15
  assert.equal(hb.scoreOf(base), 100);
  assert.equal(hb.scoreOf(over50), 120);
  assert.equal(hb.scoreOf(over75), 135);
});

test('scoreProject: stepsRemaining <= 3 adds a +10 near-finish boost', () => {
  const hb = new TestableHeartbeat({}, memoryStub);
  const far = hb.scoreOf(makeProject({ type: 'short', stepsRemaining: 4 }));  // 100
  const near = hb.scoreOf(makeProject({ type: 'short', stepsRemaining: 3 }));  // 100+10
  assert.equal(far, 100);
  assert.equal(near, 110);
});

test('scoreProject: a near-done active pipeline maxes out the additive bonuses', () => {
  const hb = new TestableHeartbeat({}, memoryStub);
  // active(100) + >50(20) + >75(15) + pipeline(10) + steps<=3(10) = 155.
  assert.equal(hb.scoreOf(makeProject({ status: 'active', progressNum: 90, type: 'novel-pipeline', stepsRemaining: 2 })), 155);
});

// ── Autonomous wake loop: highest-score selection + once-per-day idle guard ──
//
// The loop is async and timer-driven in production, but `autonomousWake` runs
// synchronously enough that injecting fast callbacks and awaiting a microtask
// flush lets us observe the decision it records in the journal.

/** Build a heartbeat wired with autonomous callbacks; returns it plus capture refs. */
function makeWiredHeartbeat(opts: {
  projects: Array<{ id: string; title: string; status: string; progress: string; progressNum: number; stepsRemaining: number; type: string }>;
  idleReturns?: string | null;
}) {
  const ranSteps: string[] = [];
  let idleCalls = 0;

  const hb = new HeartbeatService(
    { autonomousEnabled: true, quietHoursStart: 0, quietHoursEnd: 0 }, // quiet 0-0 = never quiet
    memoryStub,
  );

  const runStep = async (projectId: string) => {
    ranSteps.push(projectId);
    // Return a terminal step (no nextStep) so the loop stops after one execution.
    return { completed: 'step', response: '', wordCount: 100 };
  };
  const listProjects = () => opts.projects;
  const broadcast = () => {};
  const idleTask = async () => { idleCalls++; return opts.idleReturns ?? null; };

  hb.setAutonomous(runStep, listProjects, broadcast, undefined, undefined, idleTask);
  return { hb, ranSteps, getIdleCalls: () => idleCalls };
}

/** Invoke the private autonomousWake directly and let its awaits settle. */
async function wake(hb: HeartbeatService): Promise<void> {
  await (hb as unknown as { autonomousWake(): Promise<void> }).autonomousWake();
}

test('autonomousWake selects the highest-scoring project to run first', async () => {
  const { hb, ranSteps } = makeWiredHeartbeat({
    projects: [
      // lower score: pending, early progress
      { id: 'low', title: 'Low', status: 'pending', progress: '10%', progressNum: 10, stepsRemaining: 8, type: 'short' },
      // higher score: active, near done, pipeline
      { id: 'high', title: 'High', status: 'active', progress: '90%', progressNum: 90, stepsRemaining: 2, type: 'novel-pipeline' },
    ],
  });
  await wake(hb);
  assert.equal(ranSteps[0], 'high', 'highest-scoring project should run first');

  const journal = hb.getJournal();
  const decision = journal.find(e => e.type === 'decision');
  assert.ok(decision, 'a selection decision should be journaled');
  assert.equal(decision!.metadata?.projectId, 'high');
});

test('autonomousWake skips projects with no steps remaining and runs the idle task', async () => {
  const { hb, ranSteps, getIdleCalls } = makeWiredHeartbeat({
    projects: [
      { id: 'done', title: 'Done', status: 'active', progress: '100%', progressNum: 100, stepsRemaining: 0, type: 'short' },
    ],
    idleReturns: 'tidied up the notes',
  });
  await wake(hb);
  assert.equal(ranSteps.length, 0, 'no runnable project → no steps executed');
  assert.equal(getIdleCalls(), 1, 'idle task should fire when nothing is runnable');
});

test('autonomousWake runs the idle task at most once per day', async () => {
  const { hb, getIdleCalls } = makeWiredHeartbeat({
    projects: [], // nothing runnable
    idleReturns: 'did a helpful thing',
  });
  await wake(hb);
  await wake(hb); // same day, second wake
  assert.equal(getIdleCalls(), 1, 'idle task guarded to once per day');
});
