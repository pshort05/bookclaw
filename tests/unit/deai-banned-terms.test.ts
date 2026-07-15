import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBannedCsv,
  mergeBannedTerms,
  applyBannedTerms,
  forbiddenWordsInNarration,
  forbiddenWordsBlock,
} from '../../gateway/src/services/deai/banned-terms.js';

// --- Task 2: loader + merge ---

test('parseBannedCsv splits fixed vs ban-only; bucket ignored; header skipped', () => {
  const csv = [
    'find,replace,bucket',
    'phone buzzed,phone vibrated,personal',
    'delve,,ai',
    '"a tapestry of",,ai',
  ].join('\n');
  const b = parseBannedCsv(csv);
  assert.deepEqual(b.fixed, [{ find: 'phone buzzed', replace: 'phone vibrated' }]);
  assert.deepEqual(b.banOnly.sort(), ['a tapestry of', 'delve']);
});

test('parseBannedCsv tolerates quoted field with a comma', () => {
  const csv = 'find,replace\n"quick, clean, and precise","quick and precise"';
  const b = parseBannedCsv(csv);
  assert.deepEqual(b.fixed, [{ find: 'quick, clean, and precise', replace: 'quick and precise' }]);
});

test('mergeBannedTerms: overlay overrides global by find (case-insensitive)', () => {
  const global = parseBannedCsv('find,replace\nphone buzzed,phone vibrated\ndelve,');
  const overlay = parseBannedCsv('find,replace\nPhone Buzzed,phone rang\nsmirk,');
  const m = mergeBannedTerms(global, overlay);
  // overridden fixed entry uses overlay replacement, keeps ONE entry
  assert.deepEqual(m.fixed.filter(e => e.find.toLowerCase() === 'phone buzzed'),
    [{ find: 'Phone Buzzed', replace: 'phone rang' }]);
  // global ban-only survives, overlay ban-only added
  assert.deepEqual(m.banOnly.sort(), ['delve', 'smirk']);
});

// --- Task 3: applyBannedTerms ---

test('applyBannedTerms: case-preserving at sentence start', () => {
  const r = applyBannedTerms('Phone buzzed. The phone buzzed again.',
    [{ find: 'phone buzzed', replace: 'phone vibrated' }]);
  assert.equal(r.text, 'Phone vibrated. The phone vibrated again.');
  assert.equal(r.counts['phone buzzed'], 2);
});

test('applyBannedTerms: word-boundary — bare word does not hit inside another word', () => {
  const r = applyBannedTerms('He delved. She will delve.',
    [{ find: 'delve', replace: 'dig' }]);   // "delved" must NOT change
  assert.equal(r.text, 'He delved. She will dig.');
  assert.equal(r.counts['delve'], 1);
});

test('applyBannedTerms: dialogue untouched (banned term inside quotes survives)', () => {
  const r = applyBannedTerms('The phone buzzed. "The phone buzzed," she said.',
    [{ find: 'phone buzzed', replace: 'phone vibrated' }]);
  assert.equal(r.text, 'The phone vibrated. "The phone buzzed," she said.');
  assert.equal(r.counts['phone buzzed'], 1);
});

test('applyBannedTerms: dry-run reports counts without mutating', () => {
  const src = 'The phone buzzed.';
  const r = applyBannedTerms(src, [{ find: 'phone buzzed', replace: 'phone vibrated' }], { dryRun: true });
  assert.equal(r.text, src);
  assert.equal(r.counts['phone buzzed'], 1);
});

// --- Task 4: ban-only forbidden-words injection ---

test('forbiddenWordsInNarration: only narration hits, dialogue-only term excluded', () => {
  const text = 'She would delve into it. "It is a tapestry of lies," he said.';
  const got = forbiddenWordsInNarration(text, ['delve', 'a tapestry of', 'smirk']);
  assert.deepEqual(got, ['delve']);   // "a tapestry of" only in dialogue; "smirk" absent
});

test('forbiddenWordsBlock: empty list → empty string', () => {
  assert.equal(forbiddenWordsBlock([]), '');
  assert.match(forbiddenWordsBlock(['delve']), /forbidden/i);
});
