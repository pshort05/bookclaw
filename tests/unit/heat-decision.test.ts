import { test } from 'node:test'; import assert from 'node:assert/strict';
import { intimacyDecision, looksLikeRefusal } from '../../gateway/src/services/casting/heat.js';
const ladder = { eroticaThreshold: 7, uncensoredByLevel: [{ minSpice: 7, provider: 'grok' }, { minSpice: 9, provider: 'openrouter', model: 'venice/uncensored' }], rerouteRoles: ['draft','intimacy'] };
test('no ceiling → fade to black', () => {
  const d = intimacyDecision({ score: { spice: 8, violence: 0 }, ceiling: null, ladder, genre: 'romance' });
  assert.equal(d.mode, 'fade'); assert.equal(d.spiceRoute, null);
});
test('on-page below erotica → claude + template', () => {
  const d = intimacyDecision({ score: { spice: 5, violence: 0 }, ceiling: { spice: 8, violence: 5 }, ladder, genre: 'romance' });
  assert.equal(d.mode, 'onpage_claude'); assert.equal(d.spiceRoute, null); assert.match(d.template ?? '', /intimacy\/romance\.md$/); assert.equal(d.effectiveSpice, 5);
});
test('at erotica threshold → uncensored (grok)', () => {
  const d = intimacyDecision({ score: { spice: 7, violence: 0 }, ceiling: { spice: 10, violence: 5 }, ladder, genre: 'romance' });
  assert.equal(d.mode, 'uncensored'); assert.deepEqual(d.spiceRoute, { provider: 'grok', model: undefined });
});
test('ceiling clamps below erotica', () => {
  const d = intimacyDecision({ score: { spice: 9, violence: 0 }, ceiling: { spice: 4, violence: 5 }, ladder, genre: 'romance' });
  assert.equal(d.effectiveSpice, 4); assert.equal(d.mode, 'onpage_claude');
});
test('refusal escalates on-page to uncensored', () => {
  const d = intimacyDecision({ score: { spice: 5, violence: 0 }, ceiling: { spice: 8, violence: 5 }, ladder, refusalEscalated: true, genre: 'romance' });
  assert.equal(d.mode, 'uncensored');
});

// M3: genre is user-controlled and feeds a template file path
// (library/craft/intimacy/${genre}.md) that _shared.ts reads unsanitized —
// a path-traversal genre must never produce a template to read.
test('a path-traversal genre yields no template (M3)', () => {
  const d = intimacyDecision({ score: { spice: 5, violence: 0 }, ceiling: { spice: 8, violence: 5 }, ladder, genre: '../../etc/passwd' });
  assert.equal(d.template, null);
});

test('a genre with slashes or spaces yields no template (M3)', () => {
  const d = intimacyDecision({ score: { spice: 5, violence: 0 }, ceiling: { spice: 8, violence: 5 }, ladder, genre: 'romance/../../secret' });
  assert.equal(d.template, null);
});

// L1: a verbose refusal ("I'm not comfortable writing this...") is not empty
// and not under the 50-char threshold, so it previously slipped past the
// escalation check and got saved as the chapter.
test('looksLikeRefusal detects a wordy refusal', () => {
  const text = "I'm not comfortable writing this scene in that level of detail. Let me know if you'd like me to write a fade-to-black version instead.";
  assert.equal(looksLikeRefusal(text), true);
});

test('looksLikeRefusal does not flag ordinary prose', () => {
  const text = 'A tender, emotionally grounded scene unfolds between them, quiet and unhurried.';
  assert.equal(looksLikeRefusal(text), false);
});

test('looksLikeRefusal handles empty/undefined input', () => {
  assert.equal(looksLikeRefusal(''), false);
});
