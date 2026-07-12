/**
 * Unit tests for buildArchivalBlock (AuthorAgent port item #9).
 * Pure function, no I/O — hits are hand-built fixtures.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArchivalBlock, ARCHIVAL_BLOCK_CAP } from '../../gateway/src/services/archival-recall.js';
import type { SearchHit } from '../../gateway/src/services/memory-search.js';

function makeHit(overrides: Partial<SearchHit>): SearchHit {
  return {
    id: 1,
    source: 'conversation',
    sourceRef: 'workspace/memory/conversations/2026-07-01.jsonl',
    personaId: null,
    projectId: null,
    timestamp: '2026-07-01T00:00:00.000Z',
    title: 'Untitled',
    snippet: 'a snippet',
    rank: 0,
    ...overrides,
  };
}

test('empty hits returns empty string', () => {
  assert.equal(buildArchivalBlock([]), '');
});

test('a couple of hits produces a heading and both entries', () => {
  const hits = [
    makeHit({ id: 1, title: 'Dragon Throne Scene', snippet: 'The [dragon] took the throne.' }),
    makeHit({ id: 2, title: 'Chapter 3 Outline', snippet: 'Beats for [chapter] three.' }),
  ];
  const block = buildArchivalBlock(hits);
  assert.ok(block.startsWith('# From Your Past Work'));
  assert.match(block, /Dragon Throne Scene/);
  assert.match(block, /The \[dragon\] took the throne\./);
  assert.match(block, /Chapter 3 Outline/);
  assert.match(block, /Beats for \[chapter\] three\./);
});

test('whole-hit-or-skip: a small budget includes only the first whole hit, never a truncated one', () => {
  const hits = [
    makeHit({ id: 1, title: 'First', snippet: 'short snippet one' }),
    makeHit({ id: 2, title: 'Second', snippet: 'short snippet two' }),
  ];
  // Budget large enough for the heading + first entry, too small for both.
  const firstEntryLen = '- **First**: short snippet one'.length;
  const budget = '# From Your Past Work'.length + 1 + firstEntryLen;
  const block = buildArchivalBlock(hits, budget);
  assert.match(block, /First/);
  assert.doesNotMatch(block, /Second/);
  // No truncation marker or partial second entry leaked in.
  assert.ok(block.length <= budget);
});

test('a single hit exceeding the budget returns empty string', () => {
  const hits = [makeHit({ title: 'Huge', snippet: 'x'.repeat(ARCHIVAL_BLOCK_CAP) })];
  assert.equal(buildArchivalBlock(hits), '');
});

test('default budgetChars is ARCHIVAL_BLOCK_CAP (1800)', () => {
  assert.equal(ARCHIVAL_BLOCK_CAP, 1800);
});
