/**
 * Unit tests for gateway/src/api/routes/_shared.ts asyncHandler — the crash-safety
 * wrapper that routes rejected promises (and sync throws) from async Express
 * handlers to next(err) instead of letting them become unhandled rejections that
 * crash the Node 22 process. Exercised without a real server: mock req/res and a
 * simple next() spy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asyncHandler } from '../../gateway/src/api/routes/_shared.js';

const fakeReq = {} as any;
const fakeRes = {} as any;

test('a rejecting handler routes the error to next() (process does not throw)', async () => {
  const boom = new Error('boom');
  let nextErr: unknown = undefined;
  const next = (e?: unknown) => { nextErr = e; };

  const wrapped = asyncHandler(async () => { throw boom; });
  await wrapped(fakeReq, fakeRes, next as any);

  assert.equal(nextErr, boom);
});

test('an async fn that returns a rejected promise routes to next()', async () => {
  const err = new Error('rejected');
  let nextErr: unknown = undefined;
  const next = (e?: unknown) => { nextErr = e; };

  const wrapped = asyncHandler(() => Promise.reject(err));
  await wrapped(fakeReq, fakeRes, next as any);

  assert.equal(nextErr, err);
});

test('a throw before the first await in an async fn is routed to next()', async () => {
  const err = new Error('early throw');
  let nextErr: unknown = undefined;
  const next = (e?: unknown) => { nextErr = e; };

  // An async fn that throws synchronously in its body still produces a rejected
  // promise (async functions never throw synchronously), so .catch(next) gets it.
  const wrapped = asyncHandler(async () => { throw err; });
  await wrapped(fakeReq, fakeRes, next as any);

  assert.equal(nextErr, err);
});

test('a handler that resolves normally does NOT call next with an error', async () => {
  let nextCalled = false;
  let nextArg: unknown = undefined;
  const next = (e?: unknown) => { nextCalled = true; nextArg = e; };

  const wrapped = asyncHandler(async (_req, res) => { (res as any).done = true; });
  await wrapped(fakeReq, fakeRes, next as any);

  assert.equal(nextCalled, false, 'next should not be invoked on success');
  assert.equal(nextArg, undefined);
  assert.equal((fakeRes as any).done, true, 'handler body ran');
});

test('the handler receives the same req/res/next it was called with', async () => {
  let seen: { req: any; res: any; next: any } | undefined;
  const next = () => {};
  const wrapped = asyncHandler(async (req, res, n) => { seen = { req, res, next: n }; });
  await wrapped(fakeReq, fakeRes, next as any);

  assert.equal(seen?.req, fakeReq);
  assert.equal(seen?.res, fakeRes);
  assert.equal(seen?.next, next);
});

test('asyncHandler returns a function (an Express handler)', () => {
  const wrapped = asyncHandler(async () => {});
  assert.equal(typeof wrapped, 'function');
});
