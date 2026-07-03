/**
 * Tests for ProviderThrottle (Flagship Plan 6, Task 2): caps concurrent
 * in-flight calls per AI provider so a burst of parallel steps (e.g. a
 * parallel step group, or several books driving at once) doesn't storm a
 * rate-limited provider. Queues excess calls FIFO per provider.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderThrottle } from '../../gateway/src/services/pipeline/provider-throttle.js';

/** A deferred promise so the test controls exactly when a fake call finishes. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

test('two concurrent run(grok) calls execute serially under a limit of 1', async () => {
  const throttle = new ProviderThrottle({ grok: 1 });
  const order: string[] = [];
  const first = deferred<string>();

  const p1 = throttle.run('grok', async () => {
    order.push('start-1');
    const v = await first.promise;
    order.push('end-1');
    return v;
  });

  // Give p1 a tick to actually start (claim the slot) before firing p2.
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['start-1']);

  const p2 = throttle.run('grok', async () => {
    order.push('start-2');
    return 'two';
  });

  // p2 must NOT have started yet — the slot is held by p1.
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(order, ['start-1'], 'second call queues while the slot is held');

  first.resolve('one');
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, 'one');
  assert.equal(r2, 'two');
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2']);
});

test('different providers run in parallel (no cross-provider blocking)', async () => {
  const throttle = new ProviderThrottle({ grok: 1, claude: 1 });
  const order: string[] = [];
  const grokGate = deferred<void>();

  const grokRun = throttle.run('grok', async () => {
    order.push('grok-start');
    await grokGate.promise;
    order.push('grok-end');
  });

  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['grok-start']);

  // claude is a different provider — must run immediately even though grok's
  // single slot is held.
  const claudeRun = throttle.run('claude', async () => {
    order.push('claude-start');
    order.push('claude-end');
  });
  await claudeRun;
  assert.deepEqual(order, ['grok-start', 'claude-start', 'claude-end']);

  grokGate.resolve();
  await grokRun;
  assert.deepEqual(order, ['grok-start', 'claude-start', 'claude-end', 'grok-end']);
});

test('a default limit applies to unlisted providers', async () => {
  const throttle = new ProviderThrottle({ grok: 1, default: 1 });
  const order: string[] = [];
  const gate = deferred<void>();

  const first = throttle.run('some-new-provider', async () => {
    order.push('start-1');
    await gate.promise;
    order.push('end-1');
  });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['start-1']);

  const second = throttle.run('some-new-provider', async () => {
    order.push('start-2');
  });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(order, ['start-1'], 'unlisted provider is still capped by the default limit');

  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2']);
});

test('a thrown fn still releases its slot for the next queued call', async () => {
  const throttle = new ProviderThrottle({ grok: 1 });
  await assert.rejects(() => throttle.run('grok', async () => { throw new Error('boom'); }));
  // Slot must be free again — this resolves promptly, not hung.
  const result = await throttle.run('grok', async () => 'ok');
  assert.equal(result, 'ok');
});
