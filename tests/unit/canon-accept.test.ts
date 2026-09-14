/**
 * Canon-accept store — the author's decision on an ambiguous canon-drift gate.
 *
 * Before this, a `canon-drift-gate` / `reconcile-canon` confirmation asked for a
 * decision NO code ever read: Approve and Reject were the same no-op, so a
 * rejected gate's invented place names came straight back in the next doc. The
 * store makes Approve mean "these places are canon for this book" (persisted, then
 * fed to the gate as a KNOWN phrase so it stops flagging them) and Reject mean
 * "not canon" (recorded as declined — the honest record of the choice; no code
 * reads it and no later gate behaves differently because of it).
 *
 * The load-bearing invariant, guarded below: accepting a place changes NOTHING
 * except that the phrase stops being reported. Same swaps, same ambiguous set, same
 * unverifiable set, same no-anchor decision. That is why accepted phrases are a
 * separate `entityGate` input and never anchor text — the anchor also supplies the
 * candidate swap targets and the "is there an anchor at all" test.
 *
 * Run: node --import tsx --test tests/unit/canon-accept.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'net';
import {
  CANON_PLACES_SCHEMA_VERSION,
  canonPlacesPath,
  loadCanonPlaces,
  recordCanonPlaces,
  acceptedPlacePhrases,
  applyCanonDriftDecision,
} from '../../gateway/src/services/canon-accept.js';
import { entityGate, canonDriftAudit, runCanonDriftGate, type CanonGateStep } from '../../gateway/src/services/canon-drift.js';
import { mountKnowledge } from '../../gateway/src/api/routes/knowledge.routes.js';

function tmpBook(): string {
  const root = mkdtempSync(join(tmpdir(), 'canon-accept-'));
  const dir = join(root, 'books', 'my-book');
  mkdirSync(dir, { recursive: true });
  return dir;
}

const CONFLICTS = [
  { phrase: 'Bay Haven', reason: 'unknown town "Bay Haven" — anchor has 2 candidate towns' },
  { phrase: 'Cypress Boulevard', reason: 'unknown road "Cypress Boulevard" — anchor has 0 candidate roads' },
];

function request(service: string, extra: Record<string, unknown> = {}) {
  return { service, action: 'reconcile-canon', payload: { bookSlug: 'my-book', docLabel: 'Setting', conflicts: CONFLICTS, ...extra } };
}

// ── The decision is persisted ───────────────────────────────────────────────

test('approving a canon-drift gate persists its phrases, and the gate reads them back', () => {
  const dir = tmpBook();
  try {
    const out = applyCanonDriftDecision(() => dir, request('canon-drift-gate'), 'accepted');
    assert.ok(out, 'a canon-drift-gate request is handled');
    assert.equal(out!.recorded, 2);

    const file = loadCanonPlaces(dir);
    assert.equal(file.schemaVersion, CANON_PLACES_SCHEMA_VERSION);
    assert.deepEqual(file.accepted.map((e) => e.phrase).sort(), ['Bay Haven', 'Cypress Boulevard']);
    assert.equal(file.declined.length, 0);
    // kind + when + who are recorded
    const bay = file.accepted.find((e) => e.phrase === 'Bay Haven')!;
    assert.equal(bay.kind, 'town');
    assert.equal(file.accepted.find((e) => e.phrase === 'Cypress Boulevard')!.kind, 'road');
    assert.equal(bay.by, 'user');
    assert.ok(!Number.isNaN(Date.parse(bay.at)), 'at is an ISO timestamp');

    assert.deepEqual(acceptedPlacePhrases(dir).sort(), ['Bay Haven', 'Cypress Boulevard']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rejecting records the phrases as declined and does NOT accept them', () => {
  const dir = tmpBook();
  try {
    const out = applyCanonDriftDecision(() => dir, request('canon-drift-gate'), 'declined');
    assert.equal(out!.recorded, 2);

    const file = loadCanonPlaces(dir);
    assert.equal(file.accepted.length, 0);
    assert.deepEqual(file.declined.map((e) => e.phrase).sort(), ['Bay Haven', 'Cypress Boulevard']);
    assert.deepEqual(acceptedPlacePhrases(dir), [], 'a declined phrase is not canon');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── The accepted store feeds back into the gate ─────────────────────────────

// One anchor town and one anchor road: every unknown place of either class has
// exactly ONE candidate target, so the gate auto-swaps all of them.
const ONE_EACH_ANCHOR = `## Verified Canon
The story is set in Surf City. The main drag is Ocean Boulevard.`;

test('a second gate does not re-flag a phrase the author already accepted', () => {
  const dir = tmpBook();
  try {
    const doc = 'She drove from Bay Haven down Cypress Boulevard to Surf City.';

    const before = entityGate(doc, [ONE_EACH_ANCHOR]);
    const flaggedBefore = new Set(before.edits.map((e) => String(e.find).trim()));
    assert.ok(flaggedBefore.has('Bay Haven'), 'Bay Haven is flagged before acceptance');
    assert.ok(flaggedBefore.has('Cypress Boulevard'), 'Cypress Boulevard is flagged before acceptance');

    applyCanonDriftDecision(() => dir, request('canon-drift-gate'), 'accepted');

    const after = entityGate(doc, [ONE_EACH_ANCHOR], acceptedPlacePhrases(dir));
    const flaggedAfter = new Set([...after.ambiguous.map((a) => a.phrase), ...after.unverifiable.map((u) => u.phrase), ...after.edits.map((e) => String(e.find).trim())]);
    assert.ok(!flaggedAfter.has('Bay Haven'), 'Bay Haven is canon now — never flagged again');
    assert.ok(!flaggedAfter.has('Cypress Boulevard'), 'Cypress Boulevard is canon now — never flagged again');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── The invariant: an accept changes NOTHING but the accepted phrase ────────

/** Everything the gate decided, minus anything about `exclude` (the accepted phrase). */
function verdictWithout(r: ReturnType<typeof entityGate>, exclude: string) {
  return {
    swaps: r.edits.filter((e) => String(e.find).trim() !== exclude).map((e) => `${String(e.find).trim()} → ${e.replace}`).sort(),
    ambiguous: r.ambiguous.filter((a) => a.phrase !== exclude).map((a) => a.reason).sort(),
    unverifiable: r.unverifiable.filter((u) => u.phrase !== exclude).map((u) => u.reason).sort(),
  };
}

test('accepting a place leaves every OTHER place decided exactly as before', () => {
  const dir = tmpBook();
  try {
    // Three unknown places, one of each already-canon class plus a third that stays
    // unknown throughout: accepting the road must not turn "Ludlow Street" from an
    // auto-swap into a new ambiguous conflict (which is what happens the moment the
    // accepted road joins the anchor's candidate road list).
    const doc = 'She drove from Bay Haven down Cypress Boulevard to Ludlow Street.';
    const before = entityGate(doc, [ONE_EACH_ANCHOR]);
    assert.equal(before.edits.length, 3, 'all three unknown places auto-swap before any accept');

    recordCanonPlaces(dir, [{ phrase: 'Cypress Boulevard', reason: 'unknown road "Cypress Boulevard"' }], 'accepted');
    const after = entityGate(doc, [ONE_EACH_ANCHOR], acceptedPlacePhrases(dir));

    assert.deepEqual(verdictWithout(after, 'Cypress Boulevard'), verdictWithout(before, 'Cypress Boulevard'),
      'the accepted phrase is the ONLY difference the accept may make');
    assert.deepEqual(after.edits.map((e) => String(e.find).trim()).sort(), ['Bay Haven', 'Ludlow Street']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('accepting ONE road on a roadless anchor does not start swapping other streets', () => {
  const dir = tmpBook();
  try {
    // The live production shape: a grounded hamlet whose anchor names no street at
    // all, so every real street is advisory-only. Accepting one must not hand the
    // gate a candidate road list made entirely of that one accepted name.
    const roadless = '## Verified Canon\nThe grounded anchor is Phillipsport Village in Sullivan County.';
    const doc = 'She walked from Ludlow Street to Bleecker Street, then down Delancey Street.';
    const before = entityGate(doc, [roadless]);
    assert.deepEqual(before.edits, [], 'nothing is swapped when the anchor knows no roads');
    assert.equal(before.unverifiable.length, 3);

    recordCanonPlaces(dir, [{ phrase: 'Delancey Street', reason: 'unverifiable road "Delancey Street"' }], 'accepted');
    const after = entityGate(doc, [roadless], acceptedPlacePhrases(dir));

    assert.deepEqual(after.edits, [], 'accepting a road must NEVER make it a swap target for other streets');
    assert.deepEqual(after.ambiguous, [], 'and must not gate the author either');
    assert.deepEqual(after.unverifiable.map((u) => u.phrase).sort(), ['Bleecker Street', 'Ludlow Street'],
      'only the accepted street stops being reported');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a book with NO anchor stays a no-op no matter what has been accepted', async () => {
  const dir = tmpBook();
  try {
    recordCanonPlaces(dir, [{ phrase: 'Delancey Street', reason: 'unverifiable road "Delancey Street"' }], 'accepted');

    const bible = 'She drove from Ludlow Street to Bleecker Street.';
    const steps: CanonGateStep[] = [
      { label: 'Setting', skill: 'book-bible', status: 'completed', result: bible },
      { label: 'Canon Gate', skill: 'canon-drift-apply', status: 'running' },
    ];
    let persisted = 0;
    const out = await runCanonDriftGate({
      steps, step: steps[1],
      loadAnchors: async () => [],                     // no verified-canon.md, no setting seed
      accepted: acceptedPlacePhrases(dir),
      persistCanonical: async () => { persisted++; },
    });

    assert.equal(out.stats.noAnchor, true, 'an accepted place is not an anchor');
    assert.equal(out.stats.changed, false);
    assert.equal(steps[0].result, bible, 'the canon doc is untouched');
    assert.equal(persisted, 0, 'and nothing is written back to disk');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the LLM half of the hybrid audit does not rewrite an accepted place either', () => {
  const dir = tmpBook();
  try {
    recordCanonPlaces(dir, [{ phrase: 'Botany Village', reason: 'unknown town "Botany Village"' }], 'accepted');
    const anchor = '## Verified Canon\nGrounded in Phillipsport Village. Nearby: Summitville Village, Wurtsboro Village.';
    const doc = 'The bus stopped in Botany Village before dusk.';
    const llm = JSON.stringify([{ op: 'swap', find: 'Botany Village', replace: 'Summitville Village', reason: 'not canon' }]);

    assert.equal(canonDriftAudit(doc, [anchor], llm).edits.length, 1, 'without the accept the LLM edit applies');
    assert.deepEqual(canonDriftAudit(doc, [anchor], llm, acceptedPlacePhrases(dir)).edits, [],
      'the author called it canon — no half of the audit may rewrite it');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Round-trip + de-duplication ────────────────────────────────────────────

test('the store round-trips and de-duplicates repeat decisions', () => {
  const dir = tmpBook();
  try {
    recordCanonPlaces(dir, CONFLICTS, 'accepted');
    recordCanonPlaces(dir, CONFLICTS, 'accepted');
    recordCanonPlaces(dir, [{ phrase: '  bay   haven ' }], 'accepted'); // whitespace + case variant
    const file = loadCanonPlaces(dir);
    assert.equal(file.accepted.length, 2, 'the same phrase is stored once');

    // On-disk JSON is what loadCanonPlaces reads back.
    const raw = JSON.parse(readFileSync(canonPlacesPath(dir), 'utf8'));
    assert.equal(raw.schemaVersion, CANON_PLACES_SCHEMA_VERSION);
    assert.equal(raw.accepted.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a later decision moves a phrase between the accepted and declined lists', () => {
  const dir = tmpBook();
  try {
    recordCanonPlaces(dir, [{ phrase: 'Bay Haven' }], 'accepted');
    recordCanonPlaces(dir, [{ phrase: 'Bay Haven' }], 'declined');
    const file = loadCanonPlaces(dir);
    assert.equal(file.accepted.length, 0);
    assert.deepEqual(file.declined.map((e) => e.phrase), ['Bay Haven']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Fail-soft ──────────────────────────────────────────────────────────────

test('a missing store reads as empty and yields no accepted phrases', () => {
  const dir = tmpBook();
  try {
    assert.deepEqual(loadCanonPlaces(dir), { schemaVersion: CANON_PLACES_SCHEMA_VERSION, accepted: [], declined: [] });
    assert.deepEqual(acceptedPlacePhrases(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a corrupt store is quarantined, not overwritten, and never throws', () => {
  const dir = tmpBook();
  try {
    writeFileSync(canonPlacesPath(dir), '{ not json — but it held every place the author accepted');
    assert.deepEqual(loadCanonPlaces(dir).accepted, [], 'it still reads as empty (fail-soft)');

    // …and the unreadable bytes are preserved beside the store rather than destroyed
    // by the next decision.
    const aside = readdirSync(dir).filter((f) => /^canon-places\.corrupt-\d+\.json$/.test(f));
    assert.equal(aside.length, 1, 'the corrupt file is moved aside');
    assert.match(readFileSync(join(dir, aside[0]), 'utf8'), /every place the author accepted/);
    assert.equal(existsSync(canonPlacesPath(dir)), false, 'and is gone from the live path');

    // A decision on top still succeeds, writing a fresh store.
    assert.equal(applyCanonDriftDecision(() => dir, request('canon-drift-gate'), 'accepted')!.recorded, 2);
    assert.equal(loadCanonPlaces(dir).accepted.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unwritable book dir does not fail the decision', { skip: process.getuid?.() === 0 ? 'root ignores mode bits' : false }, () => {
  const dir = tmpBook();
  try {
    chmodSync(dir, 0o500);
    const out = applyCanonDriftDecision(() => dir, request('canon-drift-gate'), 'accepted');
    assert.ok(out, 'still handled');
    assert.equal(out!.recorded, 0, 'nothing persisted, but no throw');
    assert.equal(existsSync(canonPlacesPath(dir)), false);
  } finally { chmodSync(dir, 0o700); rmSync(dir, { recursive: true, force: true }); }
});

test('a throwing book-dir lookup does not fail the decision', () => {
  const out = applyCanonDriftDecision(() => { throw new Error('books service exploded'); }, request('canon-drift-gate'), 'accepted');
  assert.equal(out, null);
});

test('an unknown book slug is a no-op, not a throw', () => {
  assert.equal(applyCanonDriftDecision(() => null, request('canon-drift-gate'), 'accepted'), null);
  const dir = tmpBook();
  try {
    assert.equal(applyCanonDriftDecision(() => dir, request('canon-drift-gate', { bookSlug: null }), 'accepted'), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Other confirmation kinds are untouched ─────────────────────────────────

test('approving a NON canon-drift confirmation touches nothing', () => {
  const dir = tmpBook();
  try {
    assert.equal(applyCanonDriftDecision(() => dir, request('human-review'), 'accepted'), null);
    assert.equal(applyCanonDriftDecision(() => dir, null, 'accepted'), null);
    assert.equal(applyCanonDriftDecision(() => dir, { service: 'canon-drift-gate', payload: {} } as any, 'accepted'), null);
    assert.equal(existsSync(canonPlacesPath(dir)), false, 'no store file is created');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Through the REAL approve/reject routes ─────────────────────────────────

/** A minimal confirmation gate + books service, enough for mountKnowledge's
 *  approve/reject handlers (the only routes exercised here). */
function harness(bookDir: string | null) {
  const store = new Map<string, any>();
  const gateway = {
    getServices: () => ({
      books: { bookDir: (slug: string) => (slug === 'my-book' ? bookDir : null) },
      confirmationGate: {
        get: (id: string) => store.get(id) ?? null,
        list: () => [...store.values()],
        async approve(id: string) {
          const r = store.get(id);
          if (!r) return null;
          r.status = 'approved';
          return r;
        },
        async reject(id: string, _by: string, reason?: string) {
          const r = store.get(id);
          if (!r) return null;
          r.status = 'rejected';
          r.reason = reason;
          return r;
        },
      },
    }),
  };
  const app = express();
  app.use(express.json());
  mountKnowledge(app as any, gateway, process.cwd());
  return { app, store };
}

async function serve(app: express.Express): Promise<{ base: string; close: () => Promise<void> }> {
  const server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

test('POST /api/confirmations/:id/approve records the gate as canon (route-level)', async () => {
  const dir = tmpBook();
  const { app, store } = harness(dir);
  store.set('c1', { id: 'c1', status: 'pending', ...request('canon-drift-gate') });
  const { base, close } = await serve(app);
  try {
    const res = await fetch(`${base}/api/confirmations/c1/approve`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal((await res.json() as any).request.status, 'approved');
    assert.deepEqual(acceptedPlacePhrases(dir).sort(), ['Bay Haven', 'Cypress Boulevard']);
  } finally { await close(); rmSync(dir, { recursive: true, force: true }); }
});

test('POST /api/confirmations/:id/reject records the gate as declined (route-level)', async () => {
  const dir = tmpBook();
  const { app, store } = harness(dir);
  store.set('c1', { id: 'c1', status: 'pending', ...request('canon-drift-gate') });
  const { base, close } = await serve(app);
  try {
    const res = await fetch(`${base}/api/confirmations/c1/reject`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'invented' }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(acceptedPlacePhrases(dir), [], 'a rejected phrase is never canon');
    assert.deepEqual(loadCanonPlaces(dir).declined.map((e) => e.phrase).sort(), ['Bay Haven', 'Cypress Boulevard']);
  } finally { await close(); rmSync(dir, { recursive: true, force: true }); }
});

test('approving a non-canon confirmation through the route writes no store', async () => {
  const dir = tmpBook();
  const { app, store } = harness(dir);
  store.set('c1', { id: 'c1', status: 'pending', ...request('human-review') });
  const { base, close } = await serve(app);
  try {
    assert.equal((await fetch(`${base}/api/confirmations/c1/approve`, { method: 'POST' })).status, 200);
    assert.equal(existsSync(canonPlacesPath(dir)), false, 'no canon store is created for another gate kind');
  } finally { await close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a canon gate with no bookSlug still returns 200 and records nothing', async () => {
  const dir = tmpBook();
  const { app, store } = harness(dir);
  store.set('c1', { id: 'c1', status: 'pending', ...request('canon-drift-gate', { bookSlug: null }) });
  const { base, close } = await serve(app);
  try {
    assert.equal((await fetch(`${base}/api/confirmations/c1/approve`, { method: 'POST' })).status, 200);
    assert.equal(existsSync(canonPlacesPath(dir)), false);
  } finally { await close(); rmSync(dir, { recursive: true, force: true }); }
});
