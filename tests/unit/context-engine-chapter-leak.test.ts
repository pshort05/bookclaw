/**
 * Regression tests for VERIFIED High bug #13: the context engine leaked LATER
 * chapters (including the finale) into the prompt when regenerating an EARLY
 * chapter.
 *
 * Two related defects in ContextEngine.getRelevantContext:
 *   1. Previous-chapter fallback: regenerating chapter 1 (currentIdx === 0) fell
 *      through to summaries[last] — the finale — as the "Previous Chapter".
 *   2. "Relevant Earlier Events": filtered by character/location overlap with no
 *      chapterNumber < current guard, so regenerating chapter 5 could pull in
 *      chapters 12 and 20.
 *
 * Run: node --import tsx --test tests/unit/context-engine-chapter-leak.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContextEngine, type ProjectContext, type ChapterSummary } from '../../gateway/src/services/context-engine.js';

const PROJECT_ID = 'test-project';

/**
 * A chapter summary. Only chapters listed in `sharesAlice` reference the "Alice"
 * character; every other chapter uses a per-chapter filler character so it does
 * NOT overlap the regenerated chapter — this isolates which chapters are eligible
 * for the "Relevant Earlier Events" block.
 */
function chapter(n: number, sharesAlice: boolean): ChapterSummary {
  return {
    chapterId: `ch-${n}`,
    chapterNumber: n,
    title: `TITLE_CH${n}`,
    summary: `Summary of chapter ${n}.`,
    wordCount: 1000,
    characters: sharesAlice ? ['Alice'] : [`Filler${n}`],
    locations: [`Place${n}`],
    timelineMarker: `Day ${n}`,
    plotThreads: [],
    endingState: `ENDINGSTATE_CH${n}`,
  };
}

/**
 * Build an engine with chapters 1..n seeded in memory. Chapters whose number is
 * in `aliceChapters` share the "Alice" character with the regenerated chapter.
 */
function engineWithChapters(n: number, aliceChapters: Set<number>): ContextEngine {
  const engine = new ContextEngine('/tmp/context-engine-test-workspace');
  const summaries: ChapterSummary[] = [];
  for (let i = 1; i <= n; i++) summaries.push(chapter(i, aliceChapters.has(i)));
  const ctx: ProjectContext = {
    projectId: PROJECT_ID,
    summaries,
    entities: [
      {
        name: 'Alice',
        type: 'character',
        aliases: [],
        description: 'The protagonist.',
        firstAppearance: 'ch-1',
        lastSeen: `ch-${n}`,
        attributes: {},
        changes: [],
      },
    ],
    updatedAt: new Date().toISOString(),
  };
  // contexts is private; seed it directly for a synchronous, disk-free test.
  (engine as unknown as { contexts: Map<string, ProjectContext> }).contexts.set(PROJECT_ID, ctx);
  return engine;
}

test('regenerating chapter 1 does NOT leak the finale as Previous Chapter', () => {
  const engine = engineWithChapters(20, new Set([1, 3, 12, 20]));
  const out = engine.getRelevantContext(PROJECT_ID, 'ch-1', 'Alice at the Harbor', 12000);

  // The finale (chapter 20) must not appear as the previous chapter.
  assert.ok(!out.includes('ENDINGSTATE_CH20'), 'finale endingState leaked into chapter-1 context');
  assert.ok(!out.includes('TITLE_CH20'), 'finale title leaked into chapter-1 context');
  // There is no chapter before chapter 1 — no Previous Chapter block at all.
  assert.ok(!out.includes('### Previous Chapter'), 'chapter 1 should have no Previous Chapter block');
});

test('regenerating chapter 5 surfaces earlier chapter 3 but NOT later chapters 12/20', () => {
  // Only chapters 3 (earlier), 12 and 20 (later) share Alice with chapter 5. On
  // buggy code the earlier-events slice(0,3) surfaces 3, 12 AND 20; the fix must
  // keep only chapter 3.
  const engine = engineWithChapters(20, new Set([3, 5, 12, 20]));
  const out = engine.getRelevantContext(PROJECT_ID, 'ch-5', 'Alice at the Harbor', 12000);

  const events = out.split('### Relevant Earlier Events')[1] ?? '';
  assert.ok(events.includes('Ch 3'), 'earlier chapter 3 should appear in Relevant Earlier Events');
  // Later chapters must never appear as "earlier" events anywhere in the output.
  assert.ok(!out.includes('TITLE_CH12'), 'later chapter 12 leaked into earlier events');
  assert.ok(!out.includes('TITLE_CH20'), 'later chapter 20 (finale) leaked into earlier events');
});

test('forward generation of chapter 6 still surfaces chapter 5 as Previous Chapter (regression)', () => {
  const engine = engineWithChapters(5, new Set([1, 3, 5])); // chapter 6 not summarized yet
  const out = engine.getRelevantContext(PROJECT_ID, 'ch-6', 'Alice at the Harbor', 12000);

  assert.ok(out.includes('### Previous Chapter: TITLE_CH5'), 'chapter 5 should be the previous chapter for forward-gen chapter 6');
  assert.ok(out.includes('ENDINGSTATE_CH5'), 'chapter 5 ending state should be present');
  // Earlier chapters remain available as events.
  const events = out.split('### Relevant Earlier Events')[1] ?? '';
  assert.ok(events.includes('Ch 3') || events.includes('Ch 1'), 'earlier chapters should still surface for forward generation');
});
