/**
 * Flagship Plan 7, Task 3: an intimacy/craft template exists for each of the
 * four launch genres, and intimacyDecision (Flagship Plan 2) resolves the
 * matching template path for a flagged scene, and resolves to `fade` (no
 * template) for a typical, non-flagged scene under a low-ceiling genre.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { intimacyDecision } from '../../gateway/src/services/casting/heat.js';
import { loadCastingSheet, clearCastingSheetCache } from '../../gateway/src/services/casting/casting-sheet.js';

const LAUNCH_GENRES = ['romance', 'romantasy', 'science-fiction', 'techno-thriller'] as const;

for (const genre of LAUNCH_GENRES) {
  test(`the ${genre} intimacy template exists and has real craft guidance`, () => {
    const path = join(process.cwd(), 'library', 'craft', 'intimacy', `${genre}.md`);
    const content = readFileSync(path, 'utf-8');
    assert.ok(content.trim().length > 200, 'template should have real craft guidance, not a stub');
    assert.match(content, /consent/i);
  });

  test(`intimacyDecision resolves the ${genre} template path for a flagged, in-ceiling scene`, () => {
    clearCastingSheetCache();
    const sheet = loadCastingSheet(genre);
    const decision = intimacyDecision({
      score: { spice: 5, violence: 2 },
      ceiling: { spice: 6, violence: 6 },
      ladder: sheet?.heatLadder ?? null,
      genre,
    });
    assert.equal(decision.template, `library/craft/intimacy/${genre}.md`);
    // The resolved template path must exist on disk (not just be computed).
    readFileSync(join(process.cwd(), decision.template!), 'utf-8');
  });
}

for (const genre of ['science-fiction', 'techno-thriller'] as const) {
  test(`${genre} with a low content ceiling resolves to fade for a typical (non-intimate) scene`, () => {
    clearCastingSheetCache();
    const sheet = loadCastingSheet(genre);
    const decision = intimacyDecision({
      score: { spice: 0, violence: 1 },
      ceiling: { spice: 2, violence: 5 },
      ladder: sheet?.heatLadder ?? null,
      genre,
    });
    assert.equal(decision.mode, 'fade');
    assert.equal(decision.template, null);
  });
}
