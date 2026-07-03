/**
 * Task 2 (selectPitch divergence-preserving judge) tests
 * (gateway/src/services/pipeline/ideation-ensemble.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectPitch, type EnsemblePitch } from '../../gateway/src/services/pipeline/ideation-ensemble.js';
import { AI_PROVIDER_IDS } from '../../gateway/src/ai/router.js';

const REGISTERED = new Set<string>(AI_PROVIDER_IDS);

const PITCHES: EnsemblePitch[] = [
  { member: 'gpt', angle: 'mvp-first', pitch: 'A safe, proven heist thriller pitch.' },
  { member: 'grok', angle: 'risk-first', pitch: 'A wild, structurally risky anti-heist told backwards.' },
  { member: 'gemini', angle: 'character-first', pitch: 'A heist driven entirely by the getaway driver\'s guilt.' },
];

test('chosen is the judged pick; graftedFrom lists contributors', async () => {
  const complete = async (req: any) => {
    assert.ok(REGISTERED.has(req.provider), `judge call used unregistered provider "${req.provider}"`);
    return {
      text: JSON.stringify({
        chosen: PITCHES[1].pitch + ' (with a guilt-driven epilogue grafted in)',
        rationale: 'Boldest structural choice, strengthened with the character-first epilogue.',
        graftedFrom: ['grok', 'gemini'],
      }),
    };
  };
  const result = await selectPitch({ pitches: PITCHES, premise: 'a heist novel', complete, judgeModel: { provider: 'claude' } });
  assert.match(result.chosen, /guilt-driven epilogue/);
  assert.deepEqual(result.graftedFrom.sort(), ['gemini', 'grok']);
  assert.ok(result.rationale.length > 0);
});

test('does NOT converge to consensus — a judge that names a single strong pitch is honored verbatim, not blended', async () => {
  const complete = async () => ({
    text: JSON.stringify({ chosen: PITCHES[1].pitch, rationale: 'Strongest single pitch as-is.', graftedFrom: [] }),
  });
  const result = await selectPitch({ pitches: PITCHES, premise: 'a heist novel', complete, judgeModel: { provider: 'claude' } });
  assert.equal(result.chosen, PITCHES[1].pitch);
  assert.deepEqual(result.graftedFrom, []);
});

test('tolerant JSON parse: a judge response wrapped in a markdown code fence still parses', async () => {
  const complete = async () => ({
    text: '```json\n' + JSON.stringify({ chosen: PITCHES[0].pitch, rationale: 'ok', graftedFrom: [] }) + '\n```',
  });
  const result = await selectPitch({ pitches: PITCHES, premise: 'a heist novel', complete, judgeModel: { provider: 'claude' } });
  assert.equal(result.chosen, PITCHES[0].pitch);
});

test('tolerant JSON parse: trailing-comma / near-valid JSON is repaired via jsonrepair', async () => {
  const complete = async () => ({
    text: `{"chosen": "${PITCHES[2].pitch}", "rationale": "trailing comma below",  "graftedFrom": [],}`,
  });
  const result = await selectPitch({ pitches: PITCHES, premise: 'a heist novel', complete, judgeModel: { provider: 'claude' } });
  assert.equal(result.chosen, PITCHES[2].pitch);
});

test('a judge call that throws (unregistered/undefined provider, mirroring the real router) falls back deterministically without throwing', async () => {
  const throwingComplete = async (req: any) => {
    throw new Error(`Provider ${req.provider} not found`);
  };
  const result = await selectPitch({ pitches: PITCHES, premise: 'a heist novel', complete: throwingComplete, judgeModel: { provider: undefined as any } });
  // Fallback is deterministic: the longest pitch.
  const longest = PITCHES.reduce((b, p) => (p.pitch.length > b.pitch.length ? p : b), PITCHES[0]);
  assert.equal(result.chosen, longest.pitch);
  assert.deepEqual(result.graftedFrom, [longest.member]);
});

test('garbage (non-JSON) judge response falls back deterministically without throwing', async () => {
  const complete = async () => ({ text: 'I refuse to pick, sorry, cannot help with that.' });
  const result = await selectPitch({ pitches: PITCHES, premise: 'a heist novel', complete, judgeModel: { provider: 'claude' } });
  const longest = PITCHES.reduce((b, p) => (p.pitch.length > b.pitch.length ? p : b), PITCHES[0]);
  assert.equal(result.chosen, longest.pitch);
});

test('a judge response missing "chosen" falls back deterministically', async () => {
  const complete = async () => ({ text: JSON.stringify({ rationale: 'no chosen field' }) });
  const result = await selectPitch({ pitches: PITCHES, premise: 'a heist novel', complete, judgeModel: { provider: 'claude' } });
  const longest = PITCHES.reduce((b, p) => (p.pitch.length > b.pitch.length ? p : b), PITCHES[0]);
  assert.equal(result.chosen, longest.pitch);
});

test('an empty pitch list returns an empty chosen without calling complete', async () => {
  let called = false;
  const complete = async () => { called = true; return { text: '{}' }; };
  const result = await selectPitch({ pitches: [], premise: 'a heist novel', complete, judgeModel: { provider: 'claude' } });
  assert.equal(result.chosen, '');
  assert.equal(called, false);
});
