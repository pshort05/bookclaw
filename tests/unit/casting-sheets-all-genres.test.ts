/**
 * Flagship Plan 7, Task 1: the four launch-genre casting sheets (romance,
 * romantasy, science-fiction, techno-thriller) each load through the REAL loadCastingSheet
 * (which internally runs validateCastingSheet) and satisfy the shared
 * contract: a valid sheet, a `continuity` role model (Plan 3 requirement), and
 * proseRoles === [scene_brief, draft]. No hand-built fixtures — these are the
 * shipped library/casting/*.json files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCastingSheet, clearCastingSheetCache } from '../../gateway/src/services/casting/casting-sheet.js';

const LAUNCH_GENRES = ['romance', 'romantasy', 'science-fiction', 'techno-thriller'] as const;

for (const genre of LAUNCH_GENRES) {
  test(`loadCastingSheet('${genre}') returns a valid sheet with a continuity role and scene_brief+draft prose roles`, () => {
    clearCastingSheetCache();
    const sheet = loadCastingSheet(genre);
    assert.ok(sheet, `${genre} casting sheet must load`);
    assert.equal(sheet!.genre, genre);
    assert.ok(sheet!.roleModels.continuity, `${genre} sheet must declare a continuity role model`);
    assert.ok(typeof sheet!.roleModels.continuity!.provider === 'string' && sheet!.roleModels.continuity!.provider.length > 0);
    assert.deepEqual(sheet!.proseRoles, ['scene_brief', 'draft']);
    assert.ok(sheet!.roleModels.draft, `${genre} sheet must declare a draft role model`);
    assert.ok(Array.isArray(sheet!.ensemblePanel) && sheet!.ensemblePanel!.length > 0, `${genre} sheet must declare an ensemblePanel`);
  });
}

test('romantasy heatLadder mirrors romance: an open-door erotica threshold with an uncensored ladder', () => {
  clearCastingSheetCache();
  const sheet = loadCastingSheet('romantasy');
  const ladder = sheet!.heatLadder!;
  assert.ok(ladder, 'romantasy must declare a heatLadder');
  assert.ok(ladder.eroticaThreshold >= 1 && ladder.eroticaThreshold <= 10);
  assert.ok(ladder.uncensoredByLevel.length > 0);
  assert.ok(ladder.rerouteRoles.includes('draft'));
});

for (const genre of ['science-fiction', 'techno-thriller'] as const) {
  test(`${genre} heatLadder sets a high erotica threshold (low default spice ceiling, violence-focused genre)`, () => {
    clearCastingSheetCache();
    const sheet = loadCastingSheet(genre);
    const ladder = sheet!.heatLadder!;
    assert.ok(ladder, `${genre} must declare a heatLadder`);
    assert.ok(ladder.eroticaThreshold >= 8, `${genre} should rarely escalate to an uncensored spice route`);
    assert.ok(!sheet!.roleModels.intimacy, `${genre} has no dedicated on-page intimacy role`);
  });
}
