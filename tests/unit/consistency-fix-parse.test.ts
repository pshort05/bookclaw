/**
 * Unit tests for parseFixProposals (gateway/src/services/consistency/fix-proposer.ts):
 * a lenient parser for the fix-proposer model response. Covers: a valid JSON array
 * of edits; ```json fenced``` output; prose-wrapped JSON; garbage → []; entries
 * missing findingId/oldPhrase/newPhrase dropped; and that it never throws.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseFixProposals } from '../../gateway/src/services/consistency/fix-proposer.js';

const ONE = {
  findingId: 'abc123',
  canonicalValue: 'blue',
  targetChapter: 'chapter-3',
  oldPhrase: 'green eyes',
  newPhrase: 'blue eyes',
  note: 'reconcile to bible',
};

describe('parseFixProposals', () => {
  test('parses a valid JSON array of edits', () => {
    const out = parseFixProposals(JSON.stringify([ONE]));
    assert.equal(out.length, 1);
    assert.deepEqual(out[0], ONE);
  });

  test('parses ```json fenced``` output', () => {
    const raw = '```json\n' + JSON.stringify([ONE]) + '\n```';
    const out = parseFixProposals(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].findingId, 'abc123');
  });

  test('parses prose-wrapped JSON by slicing the outermost array', () => {
    const raw = 'Here are the edits you asked for:\n' + JSON.stringify([ONE]) + '\nHope that helps!';
    const out = parseFixProposals(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].oldPhrase, 'green eyes');
  });

  test('garbage returns []', () => {
    assert.deepEqual(parseFixProposals('the model refused to answer'), []);
    assert.deepEqual(parseFixProposals(''), []);
    assert.deepEqual(parseFixProposals('{ not json at all'), []);
  });

  test('drops entries missing findingId, oldPhrase, or newPhrase', () => {
    const arr = [
      ONE,
      { ...ONE, findingId: '' },
      { ...ONE, oldPhrase: undefined },
      { ...ONE, newPhrase: undefined },
    ];
    const out = parseFixProposals(JSON.stringify(arr));
    assert.equal(out.length, 1);
    assert.equal(out[0].findingId, 'abc123');
  });

  test('fills in missing optional fields with empty strings', () => {
    const minimal = { findingId: 'x', oldPhrase: 'a', newPhrase: 'b' };
    const out = parseFixProposals(JSON.stringify([minimal]));
    assert.equal(out.length, 1);
    assert.equal(out[0].canonicalValue, '');
    assert.equal(out[0].targetChapter, '');
    assert.equal(out[0].note, '');
  });

  test('tolerates a single object instead of an array', () => {
    const out = parseFixProposals(JSON.stringify(ONE));
    assert.equal(out.length, 1);
    assert.equal(out[0].findingId, 'abc123');
  });

  test('never throws', () => {
    assert.doesNotThrow(() => parseFixProposals('}{][garbage'));
    assert.doesNotThrow(() => parseFixProposals('null'));
  });
});
