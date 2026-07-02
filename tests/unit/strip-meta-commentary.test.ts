/**
 * stripMetaCommentary — removes the chatbot framing the model leaked into saved
 * step outputs in the reviewed run ("Okay, let's…", "Here are three…",
 * "Would you like to proceed to Step 4?", "Let's keep this momentum going!",
 * "### Saving to Book Bible…", and the stray "# Polish Chapter N" header).
 * Conservative: only strips known meta patterns, never normal prose.
 *
 * Run: node --import tsx --test tests/unit/strip-meta-commentary.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripMetaCommentary } from '../../gateway/src/services/strip-meta.js';

test('strips a leading conversational preamble line', () => {
  assert.equal(stripMetaCommentary("Okay, let's dive into the market analysis.\n\n# Market Analysis\n\nBody."), '# Market Analysis\n\nBody.');
  assert.equal(stripMetaCommentary('Here are three compelling blurb versions:\n\n## Version 1\n\nText.'), '## Version 1\n\nText.');
  assert.equal(stripMetaCommentary("Sure! Here's the chapter.\n\nThe rain fell."), 'The rain fell.');
});

test('strips the stray "# Polish/Write Chapter N" step header', () => {
  assert.equal(stripMetaCommentary('# Polish Chapter 7\n\n## Chapter 7: X\n\nProse.'), '## Chapter 7: X\n\nProse.');
});

test('strips trailing meta blocks (proceed prompts, momentum, saving narration)', () => {
  assert.equal(stripMetaCommentary('# Premise\n\nReal content.\n\nWould you like to proceed to Step 4?'), '# Premise\n\nReal content.');
  assert.equal(stripMetaCommentary('Content here.\n\n### Saving to Book Bible...\n\n*Ready to be saved.*'), 'Content here.');
  assert.equal(stripMetaCommentary('Content.\n\nLet me know which of the remaining steps to tackle next.'), 'Content.');
  assert.equal(stripMetaCommentary("Content.\n\nLet's keep this momentum going!"), 'Content.');
});

test('does NOT touch normal prose / a real chapter opening', () => {
  const prose = '## Chapter 1: The Night Shift\n\nThe rain hammered the windows as June walked in. "Hello," she said.';
  assert.equal(stripMetaCommentary(prose), prose);
  // "Here" used mid-prose (not a preamble) is safe
  const p2 = 'She stopped. Here, in the quiet, she finally breathed.';
  assert.equal(stripMetaCommentary(p2), p2);
});

test('SAFETY: never truncates prose on a mid-document meta-shaped line (the review bug)', () => {
  // A narration line containing a trailing-meta phrase MID-document must NOT cut the rest.
  const ch = '## Chapter 5\n\n"Whenever you\'re ready," the surgeon said, gloving up.\n\nShe nodded and the operation began. It lasted six hours.';
  assert.equal(stripMetaCommentary(ch), ch);
  // A legitimate "Here is …" prose opening (no colon) is preserved.
  assert.equal(stripMetaCommentary('Here is the truth nobody wanted to admit.\n\nShe said it anyway.'),
    'Here is the truth nobody wanted to admit.\n\nShe said it anyway.');
  // A real mid/late markdown heading is NOT a trailing-meta marker → preserved.
  const plan = '# Plan\n\nBody.\n\n## Next Steps for the Book\n\nDraft the epilogue.';
  assert.equal(stripMetaCommentary(plan), plan);
  // Dialogue ending the chapter is preserved (anchored to line start spares the quote).
  const dlg = '## Chapter 32\n\nThey stood together.\n\n"Shall we proceed?" she asked, smiling.';
  assert.equal(stripMetaCommentary(dlg), dlg);
});

test('empty / whitespace input is safe', () => {
  assert.equal(stripMetaCommentary(''), '');
  assert.equal(stripMetaCommentary('   \n\n  '), '');
});

test('run-review B4: drops leaked production word-count meta lines, keeps prose', () => {
  const input = [
    '# Compile Manuscript', '',
    '**Target Word Count per Chapter:** ~2500 words',
    '**Final Word Count:** 800,000 words', '',
    '# Chapter 1', '',
    'She checked the final word count on the ledger and sighed.',
  ].join('\n');
  const out = stripMetaCommentary(input);
  assert.doesNotMatch(out, /Target Word Count/, 'target-per-chapter meta line removed');
  assert.doesNotMatch(out, /\*\*Final Word Count/, 'bold final-count meta line removed');
  assert.match(out, /# Chapter 1/, 'real heading preserved');
  assert.match(out, /final word count on the ledger/, 'mid-prose mention of "word count" preserved');
});

test('run-review B4: an unbolded prose line mentioning word count is never dropped', () => {
  const prose = 'Total word count was the last thing on her mind as she ran.';
  assert.equal(stripMetaCommentary(prose), prose);
});
