/**
 * Tests for DriveScheduler (Flagship Plan 6, Task 1): a global semaphore +
 * FIFO queue layered over the existing per-project drive lock
 * (ProjectEngine.tryStartDriving/stopDriving/isDriving — bug-review #2/#5/#8).
 * These tests inject a fake lock (not the real ProjectEngine) so they pin the
 * scheduler's own semaphore/queue logic in isolation; integration coverage
 * against the real engine + real drive routes lives in scheduler-wiring.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DriveScheduler } from '../../gateway/src/services/pipeline/scheduler.js';

/** A fake drive lock with the exact ProjectEngine surface DriveScheduler depends on. */
function fakeLock() {
  const driving = new Set<string>();
  return {
    driving,
    tryStartDriving(id: string): boolean {
      if (driving.has(id)) return false;
      driving.add(id);
      return true;
    },
    stopDriving(id: string): void {
      driving.delete(id);
    },
    isDriving(id: string): boolean {
      return driving.has(id);
    },
  };
}

test('max 2: three acquires -> two running, one queued', async () => {
  const lock = fakeLock();
  const scheduler = new DriveScheduler(lock, 2);

  const a = await scheduler.acquire('a');
  const b = await scheduler.acquire('b');
  assert.equal(a, true);
  assert.equal(b, true);
  assert.deepEqual(scheduler.running().sort(), ['a', 'b']);
  assert.deepEqual(scheduler.queued(), []);

  // Third acquire must not resolve yet (no slot free) — race it against a
  // short timer to prove it's actually pending, not just slow.
  let cResolved = false;
  const cPromise = scheduler.acquire('c').then((v) => { cResolved = true; return v; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(cResolved, false, 'third acquire should still be queued');
  assert.deepEqual(scheduler.queued(), ['c']);
  assert.deepEqual(scheduler.running().sort(), ['a', 'b']);

  // Release one -> queued project starts.
  scheduler.release('a');
  const c = await cPromise;
  assert.equal(c, true);
  assert.equal(cResolved, true);
  assert.deepEqual(scheduler.running().sort(), ['b', 'c']);
  assert.deepEqual(scheduler.queued(), []);
  assert.equal(lock.isDriving('a'), false, 'release freed the underlying drive lock too');
});

test('setMaxConcurrent raising the cap drains the queue immediately', async () => {
  const lock = fakeLock();
  const scheduler = new DriveScheduler(lock, 1);

  await scheduler.acquire('a');
  let bResolved = false;
  const bPromise = scheduler.acquire('b').then((v) => { bResolved = true; return v; });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(bResolved, false);
  assert.deepEqual(scheduler.queued(), ['b']);

  scheduler.setMaxConcurrent(2);
  const b = await bPromise;
  assert.equal(b, true);
  assert.deepEqual(scheduler.running().sort(), ['a', 'b']);
  assert.deepEqual(scheduler.queued(), []);
});

test('a project already driven by another runner cannot be acquired', async () => {
  const lock = fakeLock();
  const scheduler = new DriveScheduler(lock, 3);
  // Simulate a runner holding the lock outside the scheduler's bookkeeping.
  lock.tryStartDriving('x');

  const result = await scheduler.acquire('x');
  assert.equal(result, false, 'cannot acquire a project already being driven');
  assert.deepEqual(scheduler.running(), []);
  assert.deepEqual(scheduler.queued(), []);
});

test('release on a project the scheduler never tracked is a no-op (does not touch the queue incorrectly)', async () => {
  const lock = fakeLock();
  const scheduler = new DriveScheduler(lock, 1);
  await scheduler.acquire('a');
  assert.doesNotThrow(() => scheduler.release('never-acquired'));
  assert.deepEqual(scheduler.running(), ['a']);
});

// ── M3: acquiring an already-queued projectId must not add a second queue entry ──

test('acquiring the same queued projectId twice does not create two queue entries', async () => {
  const lock = fakeLock();
  const scheduler = new DriveScheduler(lock, 1);
  await scheduler.acquire('a'); // takes the only slot

  let firstResolved = false;
  let secondResolved = false;
  const first = scheduler.acquire('b').then((v) => { firstResolved = true; return v; });
  const second = scheduler.acquire('b').then((v) => { secondResolved = true; return v; }); // duplicate queue attempt

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(firstResolved, false);
  assert.equal(secondResolved, false);
  assert.deepEqual(scheduler.queued(), ['b'], 'only one queue entry for the duplicate projectId');

  scheduler.release('a');
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult, true);
  assert.equal(secondResult, true, 'the duplicate acquire resolves via the same pending promise');
  assert.deepEqual(scheduler.running(), ['b'], 'b started exactly once, after a released its slot');
  assert.deepEqual(scheduler.queued(), []);
});

test('tryAcquireNow takes a free slot immediately and returns false at capacity without queuing', async () => {
  const lock = fakeLock();
  const scheduler = new DriveScheduler(lock, 1);
  assert.equal(scheduler.tryAcquireNow('a'), true, 'free slot claimed immediately');
  assert.deepEqual(scheduler.running(), ['a']);

  assert.equal(scheduler.tryAcquireNow('b'), false, 'no slot free — returns false, does not queue');
  assert.deepEqual(scheduler.queued(), [], 'tryAcquireNow never queues');
  assert.deepEqual(scheduler.running(), ['a']);

  assert.equal(scheduler.tryAcquireNow('a'), false, 'same-project reentrancy still returns false');
});
