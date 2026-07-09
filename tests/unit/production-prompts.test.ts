/**
 * Book-production write/polish prompt builders (run-review fixes 2026-06-30,
 * "My Fourth Medical Romance"). The write prompt must enforce strict chronology
 * (#5), beat-variety (#4) and no repeated epithets (#7); the polish prompt is
 * redefined as a line-edit + continuity normalization pass (#6) that also fixes
 * narrative person (#1) and reconciles names against the canon (#2) instead of
 * a free re-draft. Pure string builders, shared by both production code paths.
 *
 * Run: node --import tsx --test tests/unit/production-prompts.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeChapterPrompt, polishChapterPrompt } from '../../gateway/src/services/projects.js';

test('writeChapterPrompt keeps the word floor + outline/bible anchoring', () => {
  const p = writeChapterPrompt(3, 'My Book', 2500);
  assert.match(p, /Chapter 3/);
  assert.match(p, /My Book/);
  assert.match(p, /2500 words/);
  assert.match(p, /outline/i);
  // review #6: scene-breakdown + consistency directives retained from the old prompt
  assert.match(p, /scene breakdown/i);
  assert.match(p, /(bible|canon).{0,30}consisten/i);
});

test('writeChapterPrompt enforces chronology (#5), beat-variety (#4), no repeated epithet (#7)', () => {
  const p = writeChapterPrompt(5, 'T', 2500);
  // #5 strict chronological order, no flashback to an unshown scene
  assert.match(p, /chronologic/i);
  assert.match(p, /flashback/i);
  // #4 don't reuse a scene structure already used in a prior chapter
  assert.match(p, /(do not|don't|avoid).{0,60}(repeat|reuse).{0,40}(scene|beat|structure)/i);
  // #7 don't reuse a distinctive phrase/epithet across chapters
  assert.match(p, /(epithet|phrase|nickname)/i);
});

test('writeChapterPrompt forbids chat framing (output contract, 2026-07-08)', () => {
  const p = writeChapterPrompt(1, 'T', 2500);
  assert.match(p, /prose only/i);
  assert.match(p, /no commentary/i);
  assert.match(p, /no questions to the reader/i);
});

test('polishChapterPrompt is a line edit, not a rewrite, and normalizes POV + names', () => {
  const p = polishChapterPrompt(7, 'T', 2500);
  assert.match(p, /Chapter 7/);
  // #6 line edit, preserve structure (not a free re-draft)
  assert.match(p, /line edit/i);
  assert.match(p, /(preserve|keep|maintain).{0,30}(structure|scenes|plot)/i);
  // #1 normalize narrative person to the established POV
  assert.match(p, /(narrative person|point of view|\bPOV\b|first-person|third-person)/i);
  // #2 reconcile names against the canon
  assert.match(p, /(reconcile|match|against).{0,30}(canon|name)/i);
  // still forbids commentary/preamble
  assert.match(p, /no commentary|no .*preamble|do not output a list/i);
});
