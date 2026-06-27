/**
 * Unit tests for the Try-Fail Auditor extraction parser
 * (gateway/src/services/try-fail/extract.ts → parseAuditExtraction).
 * Tolerant JSON parse + clamping/coercion; never throws. Network-free.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuditExtraction } from '../../gateway/src/services/try-fail/extract.js';

const CLEAN = {
  protagonists: ['Hero'],
  attempts: [
    {
      protagonist: 'Hero',
      chapter: 1,
      goal: 'escape',
      conflict: 'locked door',
      outcome: 'failure',
      cost: 'high',
      personalStakes: 3,
      peopleAffected: 2,
    },
  ],
  crucibleSignals: [
    { kind: 'setting', description: 'sealed vault', strength: 'strong', chapter: 1 },
  ],
};

test('parseAuditExtraction: clean JSON', () => {
  const r = parseAuditExtraction(JSON.stringify(CLEAN));
  assert.equal(r.protagonists.length, 1);
  assert.equal(r.attempts.length, 1);
  assert.equal(r.attempts[0].outcome, 'failure');
  assert.equal(r.crucibleSignals.length, 1);
});

test('parseAuditExtraction: ```json fenced``` block', () => {
  const raw = '```json\n' + JSON.stringify(CLEAN) + '\n```';
  const r = parseAuditExtraction(raw);
  assert.equal(r.attempts.length, 1);
  assert.equal(r.attempts[0].protagonist, 'Hero');
});

test('parseAuditExtraction: garbage → empty shape, never throws', () => {
  const r = parseAuditExtraction('the model refused to answer politely');
  assert.deepEqual(r, { protagonists: [], attempts: [], crucibleSignals: [] });
});

test('parseAuditExtraction: empty string → empty shape', () => {
  assert.deepEqual(parseAuditExtraction(''), {
    protagonists: [],
    attempts: [],
    crucibleSignals: [],
  });
});

test('parseAuditExtraction: personalStakes clamped to 0–5', () => {
  const r = parseAuditExtraction(JSON.stringify({
    protagonists: ['A'],
    attempts: [
      { protagonist: 'A', chapter: 1, outcome: 'failure', cost: 'low', personalStakes: 99, peopleAffected: 0 },
      { protagonist: 'A', chapter: 2, outcome: 'failure', cost: 'low', personalStakes: -4, peopleAffected: 0 },
    ],
    crucibleSignals: [],
  }));
  assert.equal(r.attempts[0].personalStakes, 5);
  assert.equal(r.attempts[1].personalStakes, 0);
});

test('parseAuditExtraction: peopleAffected coerced ≥0', () => {
  const r = parseAuditExtraction(JSON.stringify({
    protagonists: ['A'],
    attempts: [
      { protagonist: 'A', chapter: 1, outcome: 'failure', cost: 'low', personalStakes: 2, peopleAffected: -10 },
    ],
    crucibleSignals: [],
  }));
  assert.equal(r.attempts[0].peopleAffected, 0);
});

test('parseAuditExtraction: invalid outcome/cost defaulted', () => {
  const r = parseAuditExtraction(JSON.stringify({
    protagonists: ['A'],
    attempts: [
      { protagonist: 'A', chapter: 1, outcome: 'banana', cost: 'enormous', personalStakes: 2, peopleAffected: 1 },
    ],
    crucibleSignals: [],
  }));
  assert.equal(r.attempts[0].outcome, 'none');
  assert.equal(r.attempts[0].cost, 'none');
});

test('parseAuditExtraction: attempts with no protagonist dropped', () => {
  const r = parseAuditExtraction(JSON.stringify({
    protagonists: ['A'],
    attempts: [
      { protagonist: '', chapter: 1, outcome: 'failure', cost: 'low', personalStakes: 2, peopleAffected: 1 },
      { chapter: 2, outcome: 'failure', cost: 'low', personalStakes: 2, peopleAffected: 1 },
      { protagonist: 'A', chapter: 3, outcome: 'failure', cost: 'low', personalStakes: 2, peopleAffected: 1 },
    ],
    crucibleSignals: [],
  }));
  assert.equal(r.attempts.length, 1);
  assert.equal(r.attempts[0].protagonist, 'A');
});

// --- review fixes (2026-06-27) ---------------------------------------------

import { condenseChapters } from '../../gateway/src/services/try-fail/extract.js';

test('parseAuditExtraction: extracts JSON wrapped in explanatory prose', () => {
  const raw = 'Here is the analysis:\n```json\n{"protagonists":["Mara"],"attempts":[{"protagonist":"Mara","chapter":1,"goal":"escape","conflict":"guards","outcome":"failure","cost":"high","personalStakes":4,"peopleAffected":2}],"crucibleSignals":[]}\n```\nHope that helps!';
  const out = parseAuditExtraction(raw);
  assert.deepEqual(out.protagonists, ['Mara']);
  assert.equal(out.attempts.length, 1);
  assert.equal(out.attempts[0].outcome, 'failure');
});

test('condenseChapters: many short chapters stay within the char budget', () => {
  const chapters = Array.from({ length: 200 }, (_, i) => ({ n: i + 1, text: 'x'.repeat(3000) }));
  const budget = 120000;
  const { chapters: out, condensed } = condenseChapters(chapters, budget);
  assert.equal(condensed, true);
  const total = out.reduce((s, c) => s + c.text.length, 0);
  assert.ok(total <= budget, `condensed total ${total} should be <= ${budget}`);
});
