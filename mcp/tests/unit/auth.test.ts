import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAuthMiddleware } from '../../src/auth.js';

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(obj: unknown) { this.body = obj; return this; },
  };
}

test('rejects a missing token with 401', () => {
  const mw = makeAuthMiddleware('right');
  const res = fakeRes();
  let nextCalled = false;
  mw({ headers: {} } as any, res as any, () => { nextCalled = true; });
  assert.equal(res.statusCode, 401);
  assert.equal(nextCalled, false);
});

test('rejects a wrong token with 401', () => {
  const mw = makeAuthMiddleware('right');
  const res = fakeRes();
  mw({ headers: { authorization: 'Bearer wrong' } } as any, res as any, () => {});
  assert.equal(res.statusCode, 401);
});

test('accepts the correct token', () => {
  const mw = makeAuthMiddleware('right');
  const res = fakeRes();
  let nextCalled = false;
  mw({ headers: { authorization: 'Bearer right' } } as any, res as any, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('a blank configured token denies everything', () => {
  const mw = makeAuthMiddleware('');
  const res = fakeRes();
  mw({ headers: { authorization: 'Bearer ' } } as any, res as any, () => {});
  assert.equal(res.statusCode, 401);
});
