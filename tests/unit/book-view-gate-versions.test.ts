/**
 * View Book gate + version-trail predicates (design §6, §2). Both are pure so
 * they run without React or a DOM.
 *
 * The gate rule is the load-bearing one: the server sends `expiresAt: ''`
 * whenever it can't read the confirmation request — including the real window
 * while `openReviewGate` is still creating it — and an unknown expiry must NOT
 * render as expired, because the expired state hides Approve / Regenerate /
 * Stop and strands the run.
 *
 * Run via: node --import tsx --test tests/unit/book-view-gate-versions.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateExpiry, pickVersion, type Version } from '../../frontend/studio/src/book-view/types.js';

const NOW = Date.parse('2026-09-12T12:00:00Z');
const at = (msFromNow: number) => new Date(NOW + msFromNow).toISOString();

test('a missing or unparseable expiry is unknown, never expired', () => {
  for (const value of ['', undefined, null, '   ', 'not-a-date']) {
    assert.equal(gateExpiry(value as string, NOW).state, 'unknown', `${JSON.stringify(value)} must not expire the gate`);
  }
});

test('a parsed timestamp in the future leaves the gate open with time left', () => {
  assert.deepEqual(gateExpiry(at(24 * 3600_000 - 60_000), NOW), { state: 'open', left: '23h 59m' });
  assert.deepEqual(gateExpiry(at(45 * 60_000), NOW), { state: 'open', left: '45m' });
  assert.deepEqual(gateExpiry(at(30_000), NOW), { state: 'open', left: '0m' });
});

test('only a parsed timestamp in the past renders the expired state', () => {
  assert.equal(gateExpiry(at(-1), NOW).state, 'expired');
  assert.equal(gateExpiry(at(0), NOW).state, 'expired');
  assert.equal(gateExpiry(at(-3600_000), NOW).state, 'expired');
});

const v = (id: string, latest = false): Version => ({ id, label: id, latest });

test('the trail highlights the explicit selection when there is one', () => {
  const versions = [v('a'), v('b', true), v('c')];
  assert.equal(pickVersion(versions, 'a').id, 'a');
  assert.equal(pickVersion(versions, 'c').id, 'c');
});

test('with no selection the trail falls back to the version flagged latest', () => {
  // A gated chapter carries a non-prose audit / the active sweep last in the
  // trail; the panes show `latest`, so the pressed button has to match it.
  const versions = [v('draft'), v('prose', true), v('audit')];
  assert.equal(pickVersion(versions, null).id, 'prose');
  assert.equal(pickVersion(versions, undefined).id, 'prose');
  assert.equal(pickVersion(versions, 'gone').id, 'prose', 'a stale selection falls back to latest too');
});

test('with nothing flagged latest the last entry still wins', () => {
  assert.equal(pickVersion([v('a'), v('b')], null).id, 'b');
});
