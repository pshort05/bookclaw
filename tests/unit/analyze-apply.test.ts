/**
 * Unit tests for gateway/src/services/pipeline/analyze-apply.ts
 * (Flagship Plan 4, Task 3 — analyze-then-apply polish).
 *
 * `analyzeChapter` merges the REAL deterministic critics (CraftCriticService,
 * DialogueAuditor — both zero-AI) plus Plan 3's continuity flags into one
 * `Findings` object; `describeFindings` turns that into the block appended to
 * the polish step's prompt. Driven against the real critic services (not
 * stubs) per the plan's preference, since they're deterministic and cheap to
 * run for real.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CraftCriticService } from '../../gateway/src/services/craft-critic.js';
import { DialogueAuditor } from '../../gateway/src/services/dialogue-auditor.js';
import { analyzeChapter, describeFindings } from '../../gateway/src/services/pipeline/analyze-apply.js';
import type { ContinuityFlag } from '../../gateway/src/services/consistency/continuity-check.js';

// A telling-heavy narrative passage (multiple TELLING_PATTERNS hits, zero
// SHOWING_PATTERNS hits) concatenated with a dialogue block: 5 consistent,
// contraction-free lines from "Marcus", then a 6th line that's markedly more
// casual/contraction-heavy — triggers DialogueAuditor's contraction-delta flag.
const CHAPTER_TEXT = [
  'Sarah was sad about the news. She felt scared walking home. Her friend was angry too, ' +
  'and she was nervous about the exam. Sarah was sad again the next morning, still felt scared of what might come.',
  '"I will not go there," said Marcus.',
  '"I am quite certain of this," said Marcus.',
  '"Indeed, that is correct," said Marcus.',
  '"I shall attend the meeting today," said Marcus.',
  '"We must proceed with caution here," said Marcus.',
  '"I can\'t believe it\'s really happening, y\'know, this is gonna be wild, I never expected any of ' +
  'this today, and I don\'t know what comes next," said Marcus.',
].join('\n\n');

function realCritics() {
  return { craftCritic: new CraftCriticService(), dialogueAuditor: new DialogueAuditor() };
}

test('analyzeChapter: a telling-heavy passage + an off-voice dialogue line yields findings naming both', () => {
  const { craftCritic, dialogueAuditor } = realCritics();
  const findings = analyzeChapter({
    text: CHAPTER_TEXT,
    chapterNumber: 3,
    craftCritic,
    dialogueAuditor,
  });

  assert.equal(findings.hasFindings, true);
  assert.ok(findings.craftFlags.some(f => f.category === 'telling'), 'expected a telling flag');
  assert.ok(findings.dialogueFlags.some(f => f.speaker === 'Marcus'), 'expected a Marcus dialogue mismatch flag');
});

test('analyzeChapter: merges Plan 3 continuity flags into the same Findings', () => {
  const { craftCritic, dialogueAuditor } = realCritics();
  const continuityFlags: ContinuityFlag[] = [
    { kind: 'contradiction', detail: 'Marcus is described as blind in chapter 1 but reads a letter here.' },
  ];
  const findings = analyzeChapter({
    text: 'A short chapter with no craft problems, just plain narrative prose that moves from scene to scene without incident.',
    chapterNumber: 4,
    craftCritic,
    dialogueAuditor,
    continuityFlags,
  });
  assert.equal(findings.continuityFlags.length, 1);
  assert.equal(findings.hasFindings, true);
});

test('analyzeChapter: a clean chapter with no issues has hasFindings === false', () => {
  const { craftCritic, dialogueAuditor } = realCritics();
  const findings = analyzeChapter({
    text: 'A short chapter with no craft problems, just plain narrative prose that moves from scene to scene without incident.',
    chapterNumber: 5,
    craftCritic,
    dialogueAuditor,
  });
  assert.equal(findings.hasFindings, false);
  assert.equal(findings.craftFlags.length, 0);
  assert.equal(findings.dialogueFlags.length, 0);
});

// ── Mis-wire detection: a fake critic that THROWS unless it receives the
// exact real-shaped args (a one-element chapters array with id/number/title/
// text) catches an arg-shape mistake — e.g. passing the chapter text as the
// projectId, or omitting `.text`. ──
test('analyzeChapter: passes the real chapter shape to CraftCriticService.analyze', () => {
  const fakeCraftCritic = {
    analyze(projectId: string, chapters: Array<{ id: string; number: number; title: string; text: string }>) {
      if (typeof projectId !== 'string' || !projectId) throw new Error('missing projectId');
      if (!Array.isArray(chapters) || chapters.length !== 1) throw new Error('expected exactly one chapter');
      const c = chapters[0];
      if (typeof c.text !== 'string' || c.text !== CHAPTER_TEXT) throw new Error('chapter.text mismatch — mis-wire');
      if (c.number !== 7) throw new Error('chapter.number mismatch — mis-wire');
      return { generatedAt: '', projectId, overall: {} as any, chapters: [], flags: [], beats: [], saveTheCatAdherence: 0 };
    },
  };
  const { dialogueAuditor } = realCritics();
  // Should not throw.
  const findings = analyzeChapter({
    text: CHAPTER_TEXT, chapterNumber: 7, craftCritic: fakeCraftCritic as any, dialogueAuditor,
  });
  assert.equal(findings.craftFlags.length, 0);
});

test('describeFindings: names the specific craft, dialogue, and continuity issues', () => {
  const { craftCritic, dialogueAuditor } = realCritics();
  const continuityFlags: ContinuityFlag[] = [{ kind: 'timeline', detail: 'Two sunsets in one afternoon.' }];
  const findings = analyzeChapter({ text: CHAPTER_TEXT, chapterNumber: 3, craftCritic, dialogueAuditor, continuityFlags });
  const block = describeFindings(findings);
  assert.match(block, /telling/i);
  assert.match(block, /Marcus/);
  assert.match(block, /Two sunsets in one afternoon/);
});
