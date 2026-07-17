/**
 * Unit tests for buildRoster (Task 5): includes primary/secondary/tertiary,
 * EXCLUDES transient, renders compact `name — role` lines, empty for an
 * empty/all-transient registry.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoster } from '../../gateway/src/services/registry/roster.js';
import type { NameRegistry } from '../../gateway/src/services/registry/types.js';

const mk = (chars: NameRegistry['characters']): NameRegistry => ({ characters: chars, locations: [] });

test('includes tertiary+ , EXCLUDES transient, renders compact name — role lines', () => {
  const r = buildRoster(mk([
    { canonical: 'Rosa Marchetti', tier: 'tertiary', role: 'regular customer', aliases: [], driftMap: [] },
    { canonical: 'Marisol', tier: 'transient', role: 'offpage staffer', aliases: [], driftMap: [] },
  ]));
  assert.match(r, /Rosa Marchetti — regular customer/);
  assert.doesNotMatch(r, /Marisol/);
  assert.match(r, /reuse these; do not invent new names/i);
});

test('empty registry → empty string (no prompt change)', () => {
  assert.equal(buildRoster(mk([])), '');
});

test('all-transient registry → empty string', () => {
  assert.equal(buildRoster(mk([{ canonical: 'X', tier: 'transient', role: 'y', aliases: [], driftMap: [] }])), '');
});
