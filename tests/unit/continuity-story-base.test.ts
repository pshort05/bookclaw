// tests/unit/continuity-story-base.test.ts
// Regression: the post-draft continuity check (checkChapter) used to extract
// every chapter with chapterStoryBase = 0, so chapter 1 scene 0 and chapter 24
// scene 0 both landed on storyTime 0. check-engine's impossibility rule
// (`priors.find(p => p.storyTime === fact.storyTime)`) then treated facts from
// DIFFERENT chapters as simultaneous and reported
// "<entity>'s <attr> is both "A" and "B" at the same point in the story."
// Measured on the live Firefly Pond book: every fact row sat at story_time 0-2
// and most flags were this artifact.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsistencyStore } from '../../gateway/src/services/consistency/fact-store.js';
import { checkChapter } from '../../gateway/src/services/consistency/continuity-check.js';
import type { LedgerFact } from '../../gateway/src/services/consistency/types.js';

const SAME_POINT = /at the same point in the story/;

function fact(p: Partial<LedgerFact>): LedgerFact {
  return {
    world: null, bookSlug: 'b1', entity: 'Jay Ferraro', aliases: ['Jay Ferraro', 'Jay'],
    attribute: 'current_location', type: 'stateful',
    valueRaw: 'AssIst office', valueNorm: 'assist office', storyTime: 0, storyElapsed: 0, timeLabel: null,
    transition: null, chapter: 'chapter-1', scene: 0, source: 'manuscript',
    evidence: 'at the AssIst office', canonical: true, ...p,
  };
}

/** An extractor stub: returns `sceneCount` scenes and the given facts verbatim. */
function aiReturning(facts: Array<Record<string, unknown>>, sceneCount = 1) {
  return async () => ({
    text: JSON.stringify({
      scenes: Array.from({ length: sceneCount }, () => ({ timeLabel: null, canonical: true })),
      facts,
      knowledgeEvents: [],
    }),
  });
}

const location = (valueNorm: string, valueRaw: string, scene = 0) => ({
  entity: 'Jay Ferraro', aliases: ['Jay Ferraro'], attribute: 'current_location', type: 'stateful',
  valueRaw, valueNorm, scene, transition: null, evidence: valueRaw,
});

async function withStore(name: string, fn: (store: ConsistencyStore) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), `continuity-story-base-${name}-`));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('better-sqlite3 unavailable — skipping'); return; }
    await fn(store);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('facts from DIFFERENT chapters are not reported as simultaneous', async () => {
  await withStore('cross-chapter', async (store) => {
    const aiSelect = () => ({ id: 'gemini' });

    // Chapter 1: Jay is at the AssIst office (scene 0). Persisted by checkChapter.
    await checkChapter({
      slug: 'b1', chapterNumber: 1, text: 'Jay crossed the AssIst office.', store,
      aiComplete: aiReturning([location('assist office', 'AssIst office')]), aiSelect,
    });

    // Chapter 2: Jay is at his apartment (also scene 0) — a perfectly ordinary
    // move between chapters, NOT two places at one moment.
    const ch2 = await checkChapter({
      slug: 'b1', chapterNumber: 2, text: "Jay unlocked his Eldridge Street door.", store,
      aiComplete: aiReturning([location("jay's apartment", "Jay's apartment (Eldridge Street, Chinatown)")]),
      aiSelect,
    });

    const bogus = ch2.flags.filter(f => SAME_POINT.test(f.detail));
    assert.deepEqual(bogus, [], `chapter-2 must not be judged simultaneous with chapter-1: ${JSON.stringify(ch2.flags)}`);
  });
});

test('a RE-DRAFT is not compared against its own previous draft', async () => {
  await withStore('re-draft', async (store) => {
    // The previous draft of chapter 2, banded exactly as the live path writes it.
    // Regenerating the chapter (a normal gate action) must not report the new
    // text as contradicting the text it replaces — same chapter, same band, so
    // the impossibility rule fired on every single regenerate.
    store.insertFacts([fact({ chapter: 'chapter-2', scene: 0, storyTime: 2 * 1000, valueRaw: 'the office', valueNorm: 'the office' })]);

    const result = await checkChapter({
      slug: 'b1', chapterNumber: 2, text: 'Jay was on the rooftop.', store,
      aiComplete: aiReturning([location('the rooftop', 'the rooftop')]),
      aiSelect: () => ({ id: 'gemini' }),
    });

    assert.deepEqual(
      result.flags, [],
      `a re-draft must not be judged against its own prior draft: ${JSON.stringify(result.flags)}`,
    );
    // …and the re-draft replaced the old row rather than accumulating.
    const rows = store.factsForBook({ world: null, bookSlug: 'b1' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].valueNorm, 'the rooftop');
  });
});

test('a DIFFERENT chapter with a real contradiction is still caught after that exclusion', async () => {
  await withStore('other-chapter-still-caught', async (store) => {
    // Chapter 1 put Jay in the office; chapter 2's own rows are excluded from the
    // comparison, but chapter 1's are not.
    store.insertFacts([fact({ chapter: 'chapter-1', scene: 0, storyTime: 1 * 1000, valueRaw: 'the office', valueNorm: 'the office' })]);

    const result = await checkChapter({
      slug: 'b1', chapterNumber: 2, text: 'Jay was on the rooftop.', store,
      aiComplete: aiReturning([location('the rooftop', 'the rooftop')]),
      aiSelect: () => ({ id: 'gemini' }),
    });

    assert.ok(
      result.flags.length > 0,
      `an unexplained move between chapters must still be reported: ${JSON.stringify(result.flags)}`,
    );
  });
});

test('a numeric-string chapterNumber is coerced, not dropped to base 0', async () => {
  await withStore('numeric-string', async (store) => {
    await checkChapter({
      slug: 'b1', chapterNumber: '3' as unknown as number, text: 'Jay stood in the rain.', store,
      aiComplete: aiReturning([location('the rain', 'the rain')]),
      aiSelect: () => ({ id: 'gemini' }),
    });

    const rows = store.factsForBook({ world: null, bookSlug: 'b1' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].chapter, 'chapter-3');
    assert.equal(rows[0].storyTime, 3 * 1000, "'3' is well-formed data — it must band like 3, not like nothing");
  });
});

test('a chapterNumber that is not a positive integer falls back LOUDLY, never silently', async () => {
  for (const [label, chapterNumber] of [
    ['zero', 0], ['nan', Number.NaN], ['undefined', undefined], ['fractional', 2.5], ['negative', -1],
  ] as Array<[string, number | undefined]>) {
    await withStore(`bad-chapter-${label}`, async (store) => {
      const logged: string[] = [];
      const realLog = console.log;
      console.log = (...a: unknown[]) => { logged.push(a.map(String).join(' ')); };
      let result;
      try {
        result = await checkChapter({
          slug: 'b1', chapterNumber: chapterNumber as number, text: 'Jay stood in the rain.', store,
          aiComplete: aiReturning([location('the rain', 'the rain')]),
          aiSelect: () => ({ id: 'gemini' }),
        });
      } finally { console.log = realLog; }

      assert.ok(Array.isArray(result!.flags)); // fail-soft: did not throw

      const rows = store.factsForBook({ world: null, bookSlug: 'b1' });
      assert.equal(rows.length, 1, `${label}: the chapter's fact should still persist`);
      assert.ok(Number.isFinite(rows[0].storyTime), `${label}: storyTime must be a real number`);
      assert.ok(
        logged.some(l => l.includes('⚠') && /not a positive integer/.test(l)),
        `${label}: the fallback must be announced, not silent — logged: ${JSON.stringify(logged)}`,
      );
    });
  }
});

test("story times are banded per chapter: chapter N lands in [N*1000, N*1000 + scenes)", async () => {
  await withStore('banding', async (store) => {
    const aiSelect = () => ({ id: 'gemini' });
    const chapters = [1, 3, 24];
    const SCENES = 3;

    for (const n of chapters) {
      await checkChapter({
        slug: 'b1', chapterNumber: n, text: `Chapter ${n} text.`, store,
        aiComplete: aiReturning(
          Array.from({ length: SCENES }, (_, s) => location(`place-${n}-${s}`, `Place ${n}.${s}`, s)),
          SCENES,
        ),
        aiSelect,
      });
    }

    const rows = store.factsForBook({ world: null, bookSlug: 'b1' });
    assert.equal(rows.length, chapters.length * SCENES);
    for (const r of rows) {
      const n = Number(r.chapter.replace('chapter-', ''));
      const base = n * 1000;
      assert.ok(
        r.storyTime >= base && r.storyTime < base + SCENES,
        `${r.chapter} scene ${r.scene} storyTime ${r.storyTime} outside [${base}, ${base + SCENES})`,
      );
      assert.equal(r.storyTime, base + r.scene);
    }

    // No two chapters share a story time — the whole point of the band.
    assert.equal(new Set(rows.map(r => r.storyTime)).size, rows.length);
  });
});
