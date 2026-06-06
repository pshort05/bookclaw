/**
 * Drift guard: the committed built-in pipeline JSON must stay byte-identical to
 * what the exporter produces from the live PROJECT_TEMPLATES constants. Until
 * Phase 3 (when the engine reads the JSON and the constants are deleted) the two
 * representations coexist; this test fails if they drift. Regenerate with:
 *   node --import tsx scripts/gen-library-pipelines.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { exportBuiltinPipelines } from '../../gateway/src/services/projects.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('committed built-in pipeline JSON matches the exporter output', () => {
  for (const pipeline of exportBuiltinPipelines()) {
    const file = join(ROOT, 'library', 'pipelines', `${pipeline.name}.json`);
    const onDisk = JSON.parse(readFileSync(file, 'utf-8'));
    assert.deepEqual(onDisk, pipeline, `${pipeline.name}.json drifted from PROJECT_TEMPLATES — regenerate it`);
  }
});
