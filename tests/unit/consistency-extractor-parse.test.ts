// tests/unit/consistency-extractor-parse.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExtractorResponse } from '../../gateway/src/services/consistency/extractor.js';

const SAMPLE = JSON.stringify({
  scenes: [{ timeLabel: 'that evening' }, { timeLabel: 'next morning' }],
  facts: [
    { entity: 'John Marsh', aliases: ['John','Marsh'], attribute: 'eye_color', type: 'immutable', valueRaw: 'emerald', valueNorm: 'green', scene: 0, transition: null, evidence: 'his emerald eyes' },
    { entity: 'John Marsh', aliases: ['John'], attribute: 'clothing_state', type: 'stateful', valueRaw: 'muddy work clothes', valueNorm: 'muddy', scene: 0, transition: null, evidence: 'still in his muddy work clothes' },
  ],
});

test('parses facts with normalized values + types and assigns scene story-time off the base', () => {
  const r = parseExtractorResponse(SAMPLE, 100);
  assert.equal(r.facts.length, 2);
  assert.equal(r.facts[0].valueNorm, 'green');
  assert.equal(r.facts[0].type, 'immutable');
  assert.equal(r.facts[0].storyTime, 100); // base + scene index 0
  assert.equal(r.scenes.length, 2);
  assert.equal(r.scenes[1].timeLabel, 'next morning');
});

test('tolerates code-fenced JSON and rejects pure garbage', () => {
  const fenced = '```json\n' + SAMPLE + '\n```';
  assert.equal(parseExtractorResponse(fenced, 0).facts.length, 2);
  assert.throws(() => parseExtractorResponse('not json at all', 0));
});
