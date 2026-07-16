import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBannedTerms } from '../../gateway/src/services/deai/banned-terms.js';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyAiNames, loadAiNamesForBook } from '../../gateway/src/services/deai/ai-names.js';
import { runChunkedDeAiSweep } from '../../gateway/src/services/deai/sweep.js';
import { parseBannedCsv } from '../../gateway/src/services/deai/banned-terms.js';
import { applyDeAiEdits, type DeAiEdit } from '../../gateway/src/services/deterministic-apply.js';

test("applyBannedTerms scope 'global' replaces inside dialogue too", () => {
  const map = [{ find: 'Sarah', replace: 'Delia' }];
  const text = 'Sarah nodded. "Hi, Sarah," he said.';
  const res = applyBannedTerms(text, map, { scope: 'global' });
  assert.equal(res.text, 'Delia nodded. "Hi, Delia," he said.');
  assert.equal(res.counts['Sarah'], 2);
});

test("applyBannedTerms default scope leaves dialogue untouched (narration only)", () => {
  const map = [{ find: 'Sarah', replace: 'Delia' }];
  const text = 'Sarah nodded. "Hi, Sarah," he said.';
  const res = applyBannedTerms(text, map); // default narration
  assert.equal(res.text, 'Delia nodded. "Hi, Sarah," he said.');
  assert.equal(res.counts['Sarah'], 1);
});

test("applyBannedTerms scope 'global' is case-preserving and word-boundary aware", () => {
  const map = [{ find: 'Patel', replace: 'Okafor' }];
  const text = 'PATEL and Patel, but not Pateling.';
  const res = applyBannedTerms(text, map, { scope: 'global' });
  assert.equal(res.text, 'OKAFOR and Okafor, but not Pateling.');
  assert.equal(res.counts['Patel'], 2);
});

test('applyAiNames replaces globally and counts per name', () => {
  const res = applyAiNames('Marcus Chen met Sarah. "Marcus Chen?" asked Sarah.',
    [{ find: 'Marcus Chen', replace: 'Theo Alvarez' }, { find: 'Sarah', replace: 'Delia' }]);
  assert.equal(res.text, 'Theo Alvarez met Delia. "Theo Alvarez?" asked Delia.');
  assert.equal(res.counts['Marcus Chen'], 2);
  assert.equal(res.counts['Sarah'], 2);
});

test('loadAiNamesForBook: seed copied to global, per-book overlay overrides by find', () => {
  const ws = mkdtempSync(join(tmpdir(), 'ainames-'));
  const seed = join(ws, 'seed-ai-names.csv');
  writeFileSync(seed, 'find,replace\nSarah,Delia\nPatel,Okafor\n');
  mkdirSync(join(ws, 'books', 'demo'), { recursive: true });
  writeFileSync(join(ws, 'books', 'demo', 'ai-names.csv'), 'find,replace\nSarah,Nadia\n');
  const map = loadAiNamesForBook(ws, 'demo', seed);
  // seed copied into workspace/.config on first load
  assert.ok(existsSync(join(ws, '.config', 'ai-names.csv')));
  // overlay overrides Sarah -> Nadia; Patel from global survives
  const bySarah = map.filter(e => e.find.toLowerCase() === 'sarah');
  assert.deepEqual(bySarah, [{ find: 'Sarah', replace: 'Nadia' }]);
  assert.ok(map.some(e => e.find === 'Patel' && e.replace === 'Okafor'));
  rmSync(ws, { recursive: true, force: true });
});

test('loadAiNamesForBook fail-soft: missing seed and files -> empty map', () => {
  const ws = mkdtempSync(join(tmpdir(), 'ainames-'));
  const map = loadAiNamesForBook(ws, 'nobook', join(ws, 'does-not-exist.csv'));
  assert.deepEqual(map, []);
  rmSync(ws, { recursive: true, force: true });
});

test('sweep runs the AI-name stage globally and reports aiNameCounts', async () => {
  const applyEdits = (base: string, edits: DeAiEdit[]) => applyDeAiEdits(base, edits);
  const res = await runChunkedDeAiSweep({
    draft: 'Sarah waved. "Bye, Sarah!" he called.',
    banned: parseBannedCsv('find,replace'),
    aiNames: [{ find: 'Sarah', replace: 'Delia' }],
    availableProviders: ['openrouter'],
    deps: { auditWindow: async () => [], applyEdits },
  });
  assert.equal(res.text, 'Delia waved. "Bye, Delia!" he called.'); // dialogue included
  assert.equal(res.aiNameCounts['Sarah'], 2);
});
