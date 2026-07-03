import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bannedContentCheck, operationalDetailGuard } from '../../gateway/src/services/casting/safety-floor.js';

test('a benign dark scene passes both checks', () => {
  const text = 'The villain loomed over the hostages, blade glinting, and the room went cold with dread.';
  const result = bannedContentCheck(text);
  assert.equal(result.ok, true);
  assert.equal(result.hardBlock, false);
  assert.deepEqual(result.flags, []);
  assert.equal(operationalDetailGuard(text).flagged, false);
});

test('a fenced code block + imperative step list flags operationalDetailGuard', () => {
  const text = `He explained the process:\n\n1. Mix the two chemicals in a 2:1 ratio.\n2. Heat to 80C.\n3. Add the catalyst slowly.\n\n\`\`\`\nmix(a, b)\nheat(80)\n\`\`\``;
  const result = operationalDetailGuard(text);
  assert.equal(result.flagged, true);
  assert.ok(result.spans.length > 0);
});

// CSAM — always fail-closed, but now requires the minor and sexual markers to
// be near each other (M4), not just present anywhere in the same chapter.
test('bannedContentCheck hard-blocks a minor + sexual marker close together (CSAM)', () => {
  const text = 'This scene depicts a sexual encounter involving a minor.';
  const result = bannedContentCheck(text);
  assert.equal(result.ok, false);
  assert.equal(result.hardBlock, true);
  assert.ok(result.reason);
});

test('bannedContentCheck does NOT hard-block a minor marker and an unrelated sexual marker far apart in the same chapter', () => {
  const filler = 'Nothing of consequence happened. '.repeat(20); // well over the 120-char proximity window
  const text = `A child laughed and chased the dog across the yard. ${filler} Later that night, in an entirely separate scene, two adults shared a sexual encounter.`;
  const result = bannedContentCheck(text);
  assert.equal(result.hardBlock, false);
  assert.equal(result.ok, true);
});

// Non-consent — M4: a bare "rape" mention (e.g. legitimate backstory in dark
// romance/thriller) must NOT hard-block the whole chapter. It downgrades to a
// review flag instead.
test('bannedContentCheck does NOT hard-fail a legitimate backstory mention of past assault', () => {
  const text = 'She had survived a rape years earlier, and the trial that followed had taught her not to trust easily.';
  const result = bannedContentCheck(text);
  assert.equal(result.ok, true);
  assert.equal(result.hardBlock, false);
  assert.ok(result.flags.length > 0, 'should still surface a review flag');
});

test('bannedContentCheck flags an on-page non-consent marker as review-worthy, not a hard block', () => {
  const text = 'She was raped in the alley while onlookers cheered.';
  const result = bannedContentCheck(text);
  assert.equal(result.ok, true);
  assert.equal(result.hardBlock, false);
  assert.ok(result.flags.length > 0);
});
