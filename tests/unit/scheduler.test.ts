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

// ── C3: a duplicate acquire for an already-queued projectId must back off, not
// share the queued promise — otherwise two runners both get true and drive the
// same project concurrently ──

test('duplicate acquire for a queued projectId: exactly one caller wins the slot', async () => {
  const lock = fakeLock();
  const scheduler = new DriveScheduler(lock, 1);
  await scheduler.acquire('a'); // takes the only slot

  const first = scheduler.acquire('b'); // queues
  const second = scheduler.acquire('b'); // duplicate — must back off

  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(scheduler.queued(), ['b'], 'only one queue entry for the duplicate projectId');

  scheduler.release('a');
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult, true, 'the original queued caller wins the slot');
  assert.equal(secondResult, false, 'the duplicate caller backs off');
  assert.deepEqual(scheduler.running(), ['b'], 'b started exactly once, after a released its slot');
  assert.deepEqual(scheduler.queued(), []);
});

test('after the winning caller releases, the project can be acquired fresh', async () => {
  const lock = fakeLock();
  const scheduler = new DriveScheduler(lock, 1);
  await scheduler.acquire('a');

  const first = scheduler.acquire('b');
  const second = scheduler.acquire('b'); // duplicate — backs off
  scheduler.release('a');
  assert.equal(await first, true);
  assert.equal(await second, false);

  // The winner finishes and releases — the lock must actually be free again.
  scheduler.release('b');
  assert.equal(lock.isDriving('b'), false, 'release freed the underlying drive lock');
  assert.equal(await scheduler.acquire('b'), true, 'fresh acquire succeeds after the winner released');
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
