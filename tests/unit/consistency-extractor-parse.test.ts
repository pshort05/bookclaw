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

const SAMPLE_V2 = JSON.stringify({
  scenes: [{ timeLabel: 'that evening', canonical: true }, { timeLabel: 'in the dream', canonical: false }],
  facts: [
    { entity: 'John', aliases: ['John'], attribute: 'eye_color', type: 'immutable', valueRaw: 'blue', valueNorm: 'blue', scene: 0, transition: null, evidence: 'blue eyes' },
    { entity: 'John', aliases: ['John'], attribute: 'can_fly', type: 'stateful', valueRaw: 'flying', valueNorm: 'flying', scene: 1, transition: null, evidence: 'he soared' },
  ],
  knowledgeEvents: [
    { knower: 'Elena', factEntity: 'Marsh', factAttribute: 'killer', factValueNorm: 'guilty', kind: 'use', source: 'reference', scene: 0, evidence: 'Elena named Marsh' },
    { knower: '', factEntity: 'X', factAttribute: 'y', factValueNorm: 'z', kind: 'use', source: 'reference', scene: 0, evidence: 'dropme' }, // empty knower -> dropped
  ],
});

test('parses sceneCanonical onto scenes and facts (default true)', () => {
  const r = parseExtractorResponse(SAMPLE_V2, 0);
  assert.equal(r.scenes[0].canonical, true);
  assert.equal(r.scenes[1].canonical, false);
  assert.equal(r.facts[0].canonical, true);   // scene 0
  assert.equal(r.facts[1].canonical, false);  // scene 1 (dream)
});

test('parses knowledgeEvents; composes factKey; drops malformed', () => {
  const r = parseExtractorResponse(SAMPLE_V2, 100);
  assert.equal(r.knowledge.length, 1);
  assert.equal(r.knowledge[0].knower, 'Elena');
  assert.equal(r.knowledge[0].factKey, 'Marsh\0killer\0guilty');
  assert.equal(r.knowledge[0].storyTime, 100); // base + scene 0
});

test('clamps an out-of-range scene index before deriving story-time / metadata (L9)', () => {
  const oob = JSON.stringify({
    scenes: [{ timeLabel: 'morning', canonical: true }, { timeLabel: 'dream', canonical: false }],
    facts: [
      { entity: 'John', aliases: ['John'], attribute: 'eye_color', type: 'immutable', valueRaw: 'blue', valueNorm: 'blue', scene: 99, transition: null, evidence: 'blue eyes' },
    ],
  });
  const r = parseExtractorResponse(oob, 100);
  assert.equal(r.facts[0].scene, 1, 'clamped to last scene index');
  assert.equal(r.facts[0].storyTime, 101, 'base + clamped scene (not base + 99)');
  assert.equal(r.facts[0].timeLabel, 'dream', 'reads the clamped scene\'s label');
  assert.equal(r.facts[0].canonical, false, 'reads the clamped scene\'s canonical flag');
});

test('v1 response (no canonical / no knowledge) defaults cleanly', () => {
  const r = parseExtractorResponse(SAMPLE, 0); // SAMPLE = the existing v1 fixture
  assert.equal(r.facts[0].canonical, true);
  assert.deepEqual(r.knowledge, []);
  assert.equal(r.scenes[0].canonical, true);
});
