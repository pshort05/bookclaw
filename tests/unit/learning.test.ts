/**
 * Unit tests for gateway/src/services/learning.ts (learn-from-experience loop).
 *
 * Exercises the three stages against a temp-dir LessonStore:
 *   (a) detectPatterns — pure-code aggregation, folded per producer
 *       (craft-critic.ts / dialogue-auditor.ts / continuity-check.ts).
 *   (b) phrasePatterns — optional single AI call, deterministic fallback.
 *   (c) dedup-aware LessonStore writes (provenance tag + confidence bump).
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { LessonStore } from '../../gateway/src/services/lessons.js';
import { LearningService } from '../../gateway/src/services/learning.js';
import type { LearnReportInput } from '../../gateway/src/services/learning.js';
import type { CraftReport, CraftFlag } from '../../gateway/src/services/craft-critic.js';
import type { DialogueReport, DialogueFlag } from '../../gateway/src/services/dialogue-auditor.js';
import type { ContinuityFlag } from '../../gateway/src/services/consistency/continuity-check.js';

// ── Fixture builders (only the fields learning.ts actually reads) ──

function craftFlag(category: CraftFlag['category'], overrides: Partial<CraftFlag> = {}): CraftFlag {
  return {
    chapterId: 'ch-1',
    chapterNumber: 1,
    title: 'Chapter 1',
    category,
    severity: 'info',
    description: `${category} issue`,
    suggestion: 'fix it',
    ...overrides,
  };
}

function craftReport(flags: CraftFlag[]): CraftReport {
  return { flags } as unknown as CraftReport;
}

function dialogueFlag(speaker: string, reason: string, overrides: Partial<DialogueFlag> = {}): DialogueFlag {
  return {
    paragraphIndex: 0,
    speaker,
    line: 'some line',
    reason,
    severity: 'warning',
    ...overrides,
  };
}

function dialogueReport(flags: DialogueFlag[]): DialogueReport {
  return { flags } as unknown as DialogueReport;
}

function continuityFlag(kind: ContinuityFlag['kind'], detail = 'detail'): ContinuityFlag {
  return { kind, detail };
}

describe('LearningService', () => {
  let dir: string;
  let lessons: LessonStore;
  let learning: LearningService;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'bc-learning-'));
    lessons = new LessonStore(dir);
    await lessons.initialize();
    learning = new LearningService(lessons);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('pattern recurrence: 3x same craft category becomes 1 lesson; a count-1 pattern is not added', async () => {
    const reports: LearnReportInput[] = [
      { type: 'craft', report: craftReport([craftFlag('adverbs'), craftFlag('adverbs'), craftFlag('adverbs')]) },
      { type: 'craft', report: craftReport([craftFlag('passive')]) },
    ];

    const outcome = await learning.learnFromReports({ reports });

    assert.equal(outcome.patternsFound.length, 2, 'both categories should be detected, even the non-recurring one');
    assert.equal(outcome.lessonsAdded.length, 1, 'only the recurring pattern becomes a lesson');
    assert.match(outcome.lessonsAdded[0].text, /\[learned:craft\/adverbs\]$/);

    const all = lessons.getAll();
    assert.equal(all.length, 1, 'LessonStore should have exactly one row');
    assert.match(all[0].lesson, /\[learned:craft\/adverbs\]$/);
    assert.equal(all[0].category, 'writing_quality');
    assert.equal(all[0].source, 'self-critique');
  });

  test('dedup: the same recurring pattern submitted twice bumps confidence instead of adding a second row', async () => {
    const reports: LearnReportInput[] = [
      { type: 'craft', report: craftReport([craftFlag('adverbs'), craftFlag('adverbs'), craftFlag('adverbs')]) },
    ];

    const first = await learning.learnFromReports({ reports });
    assert.equal(first.lessonsAdded.length, 1);
    assert.equal(first.lessonsSkippedDuplicate.length, 0);
    const initialConfidence = first.lessonsAdded[0].confidence;

    const second = await learning.learnFromReports({ reports });
    assert.equal(second.lessonsAdded.length, 0, 'no new row should be added on the second pass');
    assert.equal(second.lessonsSkippedDuplicate.length, 1, 'the recurring pattern should be recognized as a duplicate');

    const all = lessons.getAll();
    assert.equal(all.length, 1, 'still exactly one row after the second pass');
    assert.ok(
      Math.abs(all[0].confidence - (initialConfidence + 0.05)) < 1e-9,
      `expected confidence bumped by 0.05, got ${all[0].confidence} vs base ${initialConfidence}`,
    );
  });

  test('cross-type fold: craft + dialogue + continuity in one call produce the expected keys, dialogue sniffing classifies correctly', () => {
    const reports: LearnReportInput[] = [
      { type: 'craft', report: craftReport([craftFlag('adverbs')]) },
      {
        type: 'dialogue',
        report: dialogueReport([
          dialogueFlag('Alice', 'Alice is unusually casual here (contractions 80% vs their baseline 20%)'),
          dialogueFlag('Bob', "Bob's line is much longer than usual (50 words vs 10 avg)"),
          dialogueFlag('Carol', 'Carol is marked high-profanity (level 8/10) but none of their 3 line(s) contain profanity — possible sanitization; consider a targeted re-gen.'),
          dialogueFlag('Dave', 'Dave sounds like nobody in particular, for reasons unrelated to any known template'),
        ]),
      },
      { type: 'continuity', report: [continuityFlag('timeline'), continuityFlag('knowledge')] },
    ];

    const patterns = learning.detectPatterns(reports);
    const byKey = new Map(patterns.map((p) => [p.key, p]));

    assert.ok(byKey.has('craft:adverbs'));
    assert.equal(byKey.get('craft:adverbs')?.lessonCategory, 'writing_quality');

    assert.ok(byKey.has('dialogue:alice::voice-formality'), 'unusually casual/formal should classify as voice-formality');
    assert.ok(byKey.has('dialogue:bob::line-length'), 'much longer/shorter than usual should classify as line-length');
    assert.ok(byKey.has('dialogue:carol::profanity-sanitization'), 'possible sanitization should classify as profanity-sanitization');
    assert.ok(byKey.has('dialogue:dave::voice-mismatch'), 'an unrecognized reason should fall back to voice-mismatch');
    for (const key of ['dialogue:alice::voice-formality', 'dialogue:bob::line-length', 'dialogue:carol::profanity-sanitization', 'dialogue:dave::voice-mismatch']) {
      assert.equal(byKey.get(key)?.lessonCategory, 'style_voice');
    }

    assert.ok(byKey.has('continuity:timeline'));
    assert.ok(byKey.has('continuity:knowledge'));
    assert.equal(byKey.get('continuity:timeline')?.severity, 'warning', 'ContinuityFlag has no severity field — default to warning');
  });

  test('AI-phrasing fallback: a throwing aiComplete and a malformed-JSON aiComplete both fall back to the same deterministic text/tag', async () => {
    const reports: LearnReportInput[] = [
      { type: 'craft', report: craftReport([craftFlag('adverbs'), craftFlag('adverbs')]) },
    ];
    const aiSelectProvider = () => ({ id: 'free-provider' });

    const throwingComplete = async () => {
      throw new Error('transport failure');
    };
    const outcomeThrow = await learning.learnFromReports({ reports }, throwingComplete, aiSelectProvider);
    assert.equal(outcomeThrow.lessonsAdded.length, 1);
    const textFromThrow = outcomeThrow.lessonsAdded[0].text;

    // Fresh store so the second call isn't deduped against the first.
    const dir2 = mkdtempSync(join(tmpdir(), 'bc-learning-2-'));
    try {
      const lessons2 = new LessonStore(dir2);
      await lessons2.initialize();
      const learning2 = new LearningService(lessons2);

      const malformedComplete = async () => ({ text: '{not valid json at all', tokensUsed: 0, estimatedCost: 0, provider: 'free-provider' });
      const outcomeMalformed = await learning2.learnFromReports({ reports }, malformedComplete, aiSelectProvider);
      assert.equal(outcomeMalformed.lessonsAdded.length, 1);
      const textFromMalformed = outcomeMalformed.lessonsAdded[0].text;

      assert.equal(textFromThrow, textFromMalformed, 'both failure modes should fall back to the identical deterministic text');
      assert.match(textFromThrow, /\[learned:craft\/adverbs\]$/);
      assert.match(textFromMalformed, /\[learned:craft\/adverbs\]$/);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('fail-soft: a malformed entry alongside a valid one does not throw and the valid pattern still surfaces', async () => {
    const reports: any[] = [
      { type: 'craft', report: null },
      { type: 'craft', report: craftReport([craftFlag('adverbs'), craftFlag('adverbs')]) },
    ];

    assert.doesNotThrow(() => learning.detectPatterns(reports));
    const patterns = learning.detectPatterns(reports);
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0].key, 'craft:adverbs');
    assert.equal(patterns[0].count, 2);

    const outcome = await learning.learnFromReports({ reports });
    assert.equal(outcome.lessonsAdded.length, 1);
    assert.equal(lessons.getAll().length, 1);
  });
});
