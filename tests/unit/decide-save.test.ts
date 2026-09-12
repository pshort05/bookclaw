/**
 * Unit tests for `decideSave` (view-book §5 save routing).
 *
 * The rules are ORDER-DEPENDENT: a gated chapter must route to the review
 * action rather than a plain file write, because `project.review.pendingResult`
 * is not persisted and a file write is overwritten when the pipeline resumes.
 * Tests below pin both the individual rules and the order between them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSave, type SaveContext, type SaveMode } from '../../gateway/src/services/book-save-routing.js';

/** A plain, editable, latest-version chapter: every rule inactive. */
function ctx(overrides: Partial<SaveContext> = {}): SaveContext {
  return {
    versionIsLatest: true,
    itemReady: true,
    itemIsDerived: false,
    gateStepId: undefined,
    itemLatestStepId: 'step-12',
    projectIsDriving: false,
    ...overrides
  };
}

function assertRefused(result: SaveMode, what: string): string {
  assert.equal(result.mode, 'refuse', `${what} should refuse`);
  const reason = (result as { mode: 'refuse'; reason: string }).reason;
  assert.equal(typeof reason, 'string');
  assert.ok(reason.trim().length > 0, `${what} refusal reason must be non-empty`);
  return reason.toLowerCase();
}

// ---------------------------------------------------------------- each rule

test('rule 1: an earlier version is read-only', () => {
  const reason = assertRefused(decideSave(ctx({ versionIsLatest: false })), 'older version');
  assert.ok(reason.includes('read-only'), 'reason mentions read-only');
  assert.ok(reason.includes('version'), 'reason mentions versions');
});

test('rule 2: an unwritten item has nothing to edit', () => {
  const reason = assertRefused(decideSave(ctx({ itemReady: false })), 'unwritten item');
  assert.ok(reason.includes('nothing to edit'), 'reason says there is nothing to edit');
});

test('rule 3: derived (compiled) output is not editable', () => {
  const reason = assertRefused(decideSave(ctx({ itemIsDerived: true })), 'compiled item');
  assert.ok(reason.includes('compile'), 'reason mentions compiling');
  assert.ok(reason.includes('chapter'), 'reason points at editing a chapter');
});

test('rule 4: an edit on the gated item is the gate decision', () => {
  const result = decideSave(ctx({ gateStepId: 'step-12', itemLatestStepId: 'step-12' }));
  assert.deepEqual(result, { mode: 'gate-edit' });
});

test('rule 5: a chapter the pipeline is writing right now is refused', () => {
  const reason = assertRefused(decideSave(ctx({ projectIsDriving: true })), 'live drive');
  assert.ok(reason.includes('right now'), 'reason says the pipeline is writing it right now');
});

test('rule 6: otherwise a plain file write', () => {
  assert.deepEqual(decideSave(ctx()), { mode: 'file' });
});

// ------------------------------------------------------------------- order

test('order: rule 3 beats rule 4 — a derived item that is also gated refuses', () => {
  const result = decideSave(ctx({ itemIsDerived: true, gateStepId: 'step-9', itemLatestStepId: 'step-9' }));
  assertRefused(result, 'gated derived item');
});

test('order: rule 4 beats rule 5 — a gated chapter while driving is a gate-edit', () => {
  const result = decideSave(ctx({ gateStepId: 'step-12', itemLatestStepId: 'step-12', projectIsDriving: true }));
  assert.deepEqual(result, { mode: 'gate-edit' });
});

test('order: rule 1 beats everything — an older version of a gated chapter refuses', () => {
  const result = decideSave(ctx({
    versionIsLatest: false,
    gateStepId: 'step-12',
    itemLatestStepId: 'step-12',
    projectIsDriving: true
  }));
  const reason = assertRefused(result, 'older version of a gated chapter');
  assert.ok(reason.includes('read-only'), 'rule 1 reason, not another rule');
});

test('order: rule 2 beats rule 3 — an unwritten derived item reports nothing to edit', () => {
  const reason = assertRefused(decideSave(ctx({ itemReady: false, itemIsDerived: true })), 'unwritten derived item');
  assert.ok(reason.includes('nothing to edit'), 'rule 2 reason, not rule 3');
});

// --------------------------------------------------------- gate identity

test('a gate on a DIFFERENT chapter leaves this one on the file path', () => {
  const result = decideSave(ctx({ gateStepId: 'step-99', itemLatestStepId: 'step-12' }));
  assert.deepEqual(result, { mode: 'file' });
});

test('undefined gateStepId never matches an undefined itemLatestStepId', () => {
  const result = decideSave(ctx({ gateStepId: undefined, itemLatestStepId: undefined }));
  assert.deepEqual(result, { mode: 'file' });
});

test('a gate with no known item step does not match', () => {
  assert.deepEqual(decideSave(ctx({ gateStepId: 'step-12', itemLatestStepId: undefined })), { mode: 'file' });
});

test('an item step with no gate open does not match', () => {
  assert.deepEqual(decideSave(ctx({ gateStepId: undefined, itemLatestStepId: 'step-12' })), { mode: 'file' });
});

test('empty-string ids are not treated as a gate hit', () => {
  assert.deepEqual(decideSave(ctx({ gateStepId: '', itemLatestStepId: '' })), { mode: 'file' });
});
