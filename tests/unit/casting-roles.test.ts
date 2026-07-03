import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStepRole, PROSE_ROLES, inferRole } from '../../gateway/src/services/casting/roles.js';

test('PROSE_ROLES is exactly scene_brief + draft', () => {
  assert.deepEqual([...PROSE_ROLES].sort(), ['draft', 'scene_brief']);
});

test('isStepRole accepts known roles, rejects others', () => {
  assert.equal(isStepRole('draft'), true);
  assert.equal(isStepRole('continuity'), true);
  assert.equal(isStepRole('nonsense'), false);
  assert.equal(isStepRole(undefined), false);
});

test('inferRole maps skill/label/taskType to a role', () => {
  assert.equal(inferRole({ skill: 'write' }), 'draft');
  assert.equal(inferRole({ skill: 'book-bible' }), 'bible');
  assert.equal(inferRole({ skill: 'outline' }), 'outline');
  assert.equal(inferRole({ taskType: 'consistency' }), 'continuity');
  assert.equal(inferRole({ taskType: 'book_bible' }), 'bible');
  assert.equal(inferRole({ taskType: 'outline' }), 'outline');
  assert.equal(inferRole({ taskType: 'format' }), 'format');
  assert.equal(inferRole({ skill: 'format' }), 'format');
  assert.equal(inferRole({ label: 'Humanize — Chapter 3' }), 'humanize');
  assert.equal(inferRole({ label: 'Intimacy — Chapter 3' }), 'intimacy');
  assert.equal(inferRole({ label: 'Scene Brief — Chapter 3' }), 'scene_brief');
  assert.equal(inferRole({ label: 'Improvement Plan — Chapter 3' }), 'improve');
  assert.equal(inferRole({ label: 'Compile manuscript', taskType: 'general' }), undefined);
});
