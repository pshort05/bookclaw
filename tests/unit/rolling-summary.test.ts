/**
 * Unit tests for gateway/src/services/pipeline/rolling-summary.ts
 * (Flagship Plan 4, Task 2 — rolling-summary memory).
 *
 * `buildRollingSummary` is a PURE function over the ContextEngine's own
 * stored shapes (`ChapterSummary`/`EntityEntry` — gateway/src/services/context-engine.ts),
 * so it's driven directly with data matching those real interfaces.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRollingSummary } from '../../gateway/src/services/pipeline/rolling-summary.js';
import type { ChapterSummary, EntityEntry } from '../../gateway/src/services/context-engine.js';

function summary(n: number, overrides: Partial<ChapterSummary> = {}): ChapterSummary {
  return {
    chapterId: `ch-${n}`,
    chapterNumber: n,
    title: `Chapter ${n}`,
    summary: `Full detailed summary of chapter ${n} events and revelations.`,
    wordCount: 3000,
    characters: ['Ann'],
    locations: ['Manor'],
    timelineMarker: `Day ${n}`,
    plotThreads: ['main plot'],
    endingState: `Chapter ${n} ends with a cliffhanger.`,
    ...overrides,
  };
}

function entity(name: string, overrides: Partial<EntityEntry> = {}): EntityEntry {
  return {
    name,
    type: 'character',
    aliases: [],
    description: `${name} is a key character.`,
    firstAppearance: 'ch-1',
    lastSeen: 'ch-1',
    attributes: { mood: 'determined' },
    changes: [],
    ...overrides,
  };
}

test('buildRollingSummary: empty summaries and entities yields an empty string', () => {
  const block = buildRollingSummary({ summaries: [], entities: [], chapterNumber: 1 });
  assert.equal(block, '');
});

test('buildRollingSummary: recent chapters (last 2) appear at high fidelity; older chapters are compressed; entity registry is included', () => {
  const summaries: ChapterSummary[] = Array.from({ length: 10 }, (_, i) => summary(i + 1));
  const entities: EntityEntry[] = [entity('Ann'), entity('Marcus', { type: 'character' })];

  const block = buildRollingSummary({ summaries, entities, chapterNumber: 8 });

  // Ch 6 and 7 (the two immediately prior to 8) are the "recent" tier — full summary text present.
  assert.ok(block.includes('Full detailed summary of chapter 6 events and revelations.'));
  assert.ok(block.includes('Full detailed summary of chapter 7 events and revelations.'));
  assert.ok(block.includes('Chapter 6 ends with a cliffhanger.'));

  // Chapters 8, 9, 10 (current + future) must NEVER leak into a chapter-8 draft's memory.
  assert.doesNotMatch(block, /Full detailed summary of chapter 8/);
  assert.doesNotMatch(block, /Full detailed summary of chapter 9/);
  assert.doesNotMatch(block, /Full detailed summary of chapter 10/);

  // Older chapters (1-5) are present but compressed — NOT their full summary text.
  assert.ok(block.includes('Ch 1'));
  assert.doesNotMatch(block, /Full detailed summary of chapter 1 events and revelations\./);

  // Entity registry present.
  assert.ok(block.includes('Ann'));
  assert.ok(block.includes('Marcus'));
  assert.ok(block.includes('determined'));
});

test('buildRollingSummary: only chapters strictly before chapterNumber are included', () => {
  const summaries: ChapterSummary[] = [summary(1), summary(2), summary(3)];
  const block = buildRollingSummary({ summaries, entities: [], chapterNumber: 2 });
  assert.ok(block.includes('Chapter 1'));
  assert.doesNotMatch(block, /Chapter 3/);
});

test('buildRollingSummary: caps total block length', () => {
  const longSummary = 'x'.repeat(2000);
  const summaries: ChapterSummary[] = Array.from({ length: 20 }, (_, i) =>
    summary(i + 1, { summary: longSummary, endingState: longSummary }));
  const entities: EntityEntry[] = Array.from({ length: 20 }, (_, i) => entity(`Character${i}`, { description: longSummary }));

  const block = buildRollingSummary({ summaries, entities, chapterNumber: 20 });
  assert.ok(block.length <= 8200, `expected capped length, got ${block.length}`);
});

test('buildRollingSummary: a single prior chapter still produces a non-empty recent-tier block', () => {
  const block = buildRollingSummary({ summaries: [summary(1)], entities: [], chapterNumber: 2 });
  assert.ok(block.includes('Chapter 1'));
  assert.ok(block.includes('Full detailed summary of chapter 1'));
});
