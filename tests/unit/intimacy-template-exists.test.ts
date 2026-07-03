import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCastingSheet, clearCastingSheetCache } from '../../gateway/src/services/casting/casting-sheet.js';

test('the romance intimacy template exists and is non-empty', () => {
  const path = join(process.cwd(), 'library', 'craft', 'intimacy', 'romance.md');
  const content = readFileSync(path, 'utf-8');
  assert.ok(content.trim().length > 200, 'template should have real craft guidance, not a stub');
  assert.match(content, /consent/i);
});

test("the romance casting sheet's heatLadder parses and has a sensible erotica threshold + uncensored ladder", () => {
  clearCastingSheetCache();
  const sheet = loadCastingSheet('romance');
  assert.ok(sheet, 'romance casting sheet must load');
  const ladder = sheet!.heatLadder;
  assert.ok(ladder, 'romance casting sheet must declare a heatLadder');
  assert.ok(ladder!.eroticaThreshold >= 1 && ladder!.eroticaThreshold <= 10);
  assert.ok(ladder!.uncensoredByLevel.length > 0);
  for (const rung of ladder!.uncensoredByLevel) {
    assert.ok(rung.minSpice >= ladder!.eroticaThreshold, 'every uncensored rung should be at/above the erotica threshold');
    assert.ok(typeof rung.provider === 'string' && rung.provider.length > 0);
  }
  assert.ok(ladder!.rerouteRoles.includes('draft'));
});
