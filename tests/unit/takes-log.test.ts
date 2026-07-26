import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendTakesLog, type TakesLogRecord } from '../../gateway/src/sampling/takes-log.js';

function rec(chosenIndex: number): TakesLogRecord {
  return {
    id: 'id-' + chosenIndex, at: '2026-07-26T00:00:00.000Z', bookSlug: 'b', projectId: 'p', stepId: 's', role: 'approach',
    variant: 'cot', k: 3, threshold: 0.1, provider: 'openrouter', model: 'm', contextRef: 's',
    candidates: [{ index: 0, text: 'A' }, { index: 1, text: 'B' }], chosenIndex, edited: false, diversityScore: null, degraded: false,
  };
}

test('appendTakesLog writes a JSONL record with diversityScore:null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'takeslog-'));
  try {
    appendTakesLog(dir, rec(1));
    const lines = readFileSync(join(dir, 'vs-selections.jsonl'), 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.chosenIndex, 1);
    assert.equal(parsed.diversityScore, null);
    assert.equal(parsed.candidates.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('appendTakesLog appends (does not overwrite)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'takeslog-'));
  try {
    appendTakesLog(dir, rec(0));
    appendTakesLog(dir, rec(1));
    const lines = readFileSync(join(dir, 'vs-selections.jsonl'), 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('appendTakesLog fails soft on a bad path (no throw)', () => {
  assert.doesNotThrow(() => appendTakesLog('\0/definitely/invalid', rec(0)));
});
