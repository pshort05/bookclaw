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

test('prose-mode strips a BARE (no-#) "Polish/Write Chapter N" leading label (2026-07-08)', () => {
  assert.equal(
    stripMetaCommentary('Polish Chapter 1\n\nChapter 1: The Weight of Steel\n\nProse.', { prose: true }),
    'Chapter 1: The Weight of Steel\n\nProse.');
  assert.equal(
    stripMetaCommentary('Write Chapter 12\n\nThe rain fell.', { prose: true }),
    'The rain fell.');
  // Non-prose deliverable that legitimately opens with that exact line is left alone.
  assert.equal(
    stripMetaCommentary('Write Chapter 12\n\nThe rain fell.'),
    'Write Chapter 12\n\nThe rain fell.');
});

test('prose-mode strips trailing conversational solicitations; non-prose keeps them (2026-07-08)', () => {
  assert.equal(stripMetaCommentary('Prose.\n\nWhich direction would you like to prioritize moving forward?', { prose: true }), 'Prose.');
  assert.equal(stripMetaCommentary("Prose.\n\nI'm eager to continue building this scene!", { prose: true }), 'Prose.');
  // A report/blog deliverable is not touched by these prose-only solicitations.
  const report = 'Report body.\n\nHappy to continue refining these projections on request.';
  assert.equal(stripMetaCommentary(report), report);
});

test('prose-mode strips a trailing "Next Steps:" epilogue block; non-prose keeps it (2026-07-08)', () => {
  const leaked = [
    '## Chapter 1',
    '',
    'Elias made the incision. The monitor beeped steadily.',
    '',
    'Next Steps:',
    '',
    '- Expand on the Hemorrhage: what is causing it?',
    "- Develop Elias's Internal Conflict.",
    '',
    "Which direction would you like to prioritize moving forward? I'm eager to continue building this scene!",
  ].join('\n');
  const cleaned = stripMetaCommentary(leaked, { prose: true });
  assert.doesNotMatch(cleaned, /Next Steps:/);
  assert.doesNotMatch(cleaned, /which direction would you like/i);
  assert.match(cleaned, /Elias made the incision/);
  // Default (non-prose) keeps the "Next Steps:" heading (legit in reports/outlines).
  assert.match(stripMetaCommentary(leaked), /Next Steps:/);
});

test('prose-mode "Chapter Ending Hook:" epilogue (chatbot tail) stripped; preserves real prose before it (2026-07-08)', () => {
  const leaked = '## Chapter 3\n\nShe closed the door.\n\nChapter Ending Hook:\n\nA shadow moved behind her.\n\nWhich direction would you like to explore next?';
  assert.equal(stripMetaCommentary(leaked, { prose: true }), '## Chapter 3\n\nShe closed the door.');
});

test('prose-mode never empties a doc: an epilogue heading as the FIRST paragraph is left alone (2026-07-08)', () => {
  const only = 'Next Steps:\n\n- do things';
  assert.equal(stripMetaCommentary(only, { prose: true }), only);
});

test('SAFETY: prose-mode does NOT slice a same-named heading MID-document — trailing prose survives (2026-07-08)', () => {
  // A standalone "Next Steps" line early in a long chapter (in-world note) must
  // not delete all the real prose after it (code-review data-loss finding #1).
  const ch = [
    '## Chapter 5',
    '',
    'She read the whiteboard aloud.',
    '',
    'Next Steps',           // an in-world heading, NOT the trailing epilogue
    '',
    'The list went on, but she had already stopped listening.',
    '',
    'Hours later, the storm broke and everything changed. She ran for the door.',
    '',
    'By dawn it was over, and the city lay quiet beneath a grey and steady rain.',
  ].join('\n');
  const out = stripMetaCommentary(ch, { prose: true });
  assert.match(out, /storm broke/, 'prose after a mid-document heading is preserved');
  assert.match(out, /the city lay quiet/, 'the final real paragraph survives');
});
