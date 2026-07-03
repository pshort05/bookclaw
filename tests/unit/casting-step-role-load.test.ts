import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isStepRole } from '../../gateway/src/services/casting/roles.js';

// The pipeline JSON step carries a `role`; createProjectFromPipeline copies it
// onto the ProjectStep verbatim when it is a valid StepRole. This test asserts
// the contract at the copy helper level (extracted for testability).
import { readStepRole } from '../../gateway/src/services/projects.js';

test('readStepRole passes through a valid role and drops an invalid one', () => {
  assert.equal(readStepRole({ role: 'draft' }), 'draft');
  assert.equal(readStepRole({ role: 'bogus' }), undefined);
  assert.equal(readStepRole({}), undefined);
});
