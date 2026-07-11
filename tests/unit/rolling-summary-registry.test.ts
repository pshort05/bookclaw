/**
 * Regression test for VERIFIED Medium bug #19 in
 * gateway/src/services/pipeline/rolling-summary.ts.
 *
 * The rolling story-memory block used to emit the Entity Registry LAST and then
 * head-slice the whole joined block at BLOCK_CAP (8000). Whenever the narrative
 * sections (recent/arc/macro) overflowed the cap — which happens for later
 * chapters of long books — the head-slice cut into or entirely dropped the
 * Entity Registry, sacrificing the very continuity roster this module exists to
 * protect. These tests pin that the registry survives the budget.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRollingSummary } from '../../gateway/src/services/pipeline/rolling-summary.js';
import type { ChapterSummary, EntityEntry } from '../../gateway/src/services/context-engine.js';

const BLOCK_CAP = 8000;

function summary(n: number, overrides: Partial<ChapterSummary> = {}): ChapterSummary {
  return {
    chapterId: `ch-${n}`,
    chapterNumber: n,
    title: `Chapter ${n}`,
    summary: `Summary of chapter ${n}.`,
    wordCount: 3000,
    characters: ['Ann'],
    locations: ['Manor'],
    timelineMarker: `Day ${n}`,
    plotThreads: ['main plot'],
    endingState: `Chapter ${n} ends.`,
    ...overrides,
  };
}

function entity(name: string, overrides: Partial<EntityEntry> = {}): EntityEntry {
  return {
    name,
    type: 'character',
    aliases: [],
    description: `${name} matters to the plot.`,
    firstAppearance: 'ch-1',
    lastSeen: 'ch-1',
    attributes: { mood: 'resolute' },
    changes: [],
    ...overrides,
  };
}

test('buildRollingSummary: entity registry survives when narrative sections overflow BLOCK_CAP', () => {
  // Two "recent" chapters with huge full-fidelity summaries push the narrative
  // well past BLOCK_CAP on their own.
  const hugeSummary = 'NARRATIVE-PROSE '.repeat(400); // ~6400 chars each
  const summaries: ChapterSummary[] = [
    ...Array.from({ length: 10 }, (_, i) => summary(i + 1)),
    summary(11, { summary: hugeSummary }),
    summary(12, { summary: hugeSummary }),
  ];

  // Distinctive, recognizable roster — must not be truncated away.
  const entities: EntityEntry[] = [
    entity('Zephyrina Voss', { type: 'character' }),
    entity('Blackthorn Keep', { type: 'location' }),
    entity('Amulet of Vorne', { type: 'item' }),
  ];

  const block = buildRollingSummary({ summaries, entities, chapterNumber: 13 });

  // The roster this module exists to protect is preserved in full.
  assert.ok(block.includes('### Entity Registry'), 'registry header missing');
  assert.ok(block.includes('Zephyrina Voss'), 'character entry dropped');
  assert.ok(block.includes('Blackthorn Keep'), 'location entry dropped');
  assert.ok(block.includes('Amulet of Vorne'), 'item entry dropped');

  // Total stays within the cap (small tolerance for the truncation marker).
  assert.ok(block.length <= BLOCK_CAP + 200, `expected capped length, got ${block.length}`);
});

test('buildRollingSummary: no regression when everything fits — all sections present unchanged', () => {
  // 12 prior chapters => recent (11,12), arc (5-10), macro (1-4) all populated.
  const summaries: ChapterSummary[] = Array.from({ length: 12 }, (_, i) => summary(i + 1));
  const entities: EntityEntry[] = [entity('Ann'), entity('Marcus')];

  const block = buildRollingSummary({ summaries, entities, chapterNumber: 13 });

  // Recent (full), arc/macro (compressed), and registry all present.
  assert.ok(block.includes('Summary of chapter 11.'));
  assert.ok(block.includes('Summary of chapter 12.'));
  assert.ok(block.includes('### Current Arc'));
  assert.ok(block.includes('### Macro Events'));
  assert.ok(block.includes('### Entity Registry'));
  assert.ok(block.includes('Ann'));
  assert.ok(block.includes('Marcus'));
  assert.ok(block.includes('resolute'));
  // Comfortably within budget, no truncation marker.
  assert.ok(block.length <= BLOCK_CAP);
  assert.doesNotMatch(block, /\[truncated\]/);
});
