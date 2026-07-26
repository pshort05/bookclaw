import { test } from 'node:test';
import assert from 'node:assert/strict';
import { temperatureBucket, resolveBucketTemperature } from '../../gateway/src/services/casting/temperature.js';

test('creative roles → creative', () => {
  for (const r of ['scene_brief', 'draft', 'intimacy', 'approach', 'improve', 'rewrite', 'outline', 'bible', 'marketing'] as const) {
    assert.equal(temperatureBucket(r, 'x'), 'creative', r);
  }
});

test('surgical roles → surgical', () => {
  for (const r of ['humanize', 'editorial', 'analysis', 'continuity', 'format', 'research', 'plan'] as const) {
    assert.equal(temperatureBucket(r, 'x'), 'surgical', r);
  }
});

test('untagged: taskType decides', () => {
  assert.equal(temperatureBucket(undefined, 'creative_writing'), 'creative');
  assert.equal(temperatureBucket(undefined, 'consistency'), 'surgical');
  assert.equal(temperatureBucket(undefined, 'final_edit'), 'surgical');
});

test('unknown role and taskType → creative', () => {
  assert.equal(temperatureBucket(undefined, 'general'), 'creative');
  assert.equal(temperatureBucket(undefined, undefined), 'creative');
});

test('resolveBucketTemperature reads the right bucket; undefined when no temps', () => {
  const temps = { creative: 0.9, surgical: 0.25 };
  assert.equal(resolveBucketTemperature(temps, 'draft', 'creative_writing'), 0.9);
  assert.equal(resolveBucketTemperature(temps, 'continuity', 'revision'), 0.25);
  assert.equal(resolveBucketTemperature(undefined, 'draft', 'creative_writing'), undefined);
  assert.equal(resolveBucketTemperature({ creative: 0.9 }, 'continuity', 'revision'), undefined); // surgical unset
});
