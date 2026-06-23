import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseBeatMappingResponse, loadStructureReview, saveStructureReview } from '../../gateway/src/services/format-review.js';

test('parseBeatMappingResponse parses fenced JSON into a mapping', () => {
  const text = '```json\n{ "mapping": { "Setup": [1,2], "Climax": [18] } }\n```';
  const r = parseBeatMappingResponse(text);
  assert.deepEqual(r.mapping['Setup'], [1, 2]);
  assert.deepEqual(r.mapping['Climax'], [18]);
});

test('parseBeatMappingResponse tolerates a custom-beats scaffold; bad input → empty mapping', () => {
  const r = parseBeatMappingResponse('{"customBeats":[{"name":"Summer One","expectedPct":12,"pctRange":[0,25],"description":"x"}],"mapping":{}}');
  assert.equal(r.customBeats?.[0].name, 'Summer One');
  assert.deepEqual(parseBeatMappingResponse('not json').mapping, {});
});

test('structure-review sidecar round-trips fail-soft', () => {
  const root = mkdtempSync(join(tmpdir(), 'sr-'));
  try {
    const dataDir = join(root, 'data'); mkdirSync(dataDir, { recursive: true });
    assert.deepEqual(loadStructureReview(dataDir), { outline: [], mapping: {} });
    saveStructureReview(dataDir, { outline: [{ chapter: 1, summary: 'opens' }], mapping: { Setup: [1] } });
    assert.deepEqual(loadStructureReview(dataDir).mapping, { Setup: [1] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
