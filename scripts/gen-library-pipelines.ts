/**
 * Regenerate library/pipelines/*.json from the live PROJECT_TEMPLATES exporter.
 * Run: node --import tsx scripts/gen-library-pipelines.ts
 * The output is committed; tests/unit/library-pipelines.test.ts guards drift.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exportBuiltinPipelines } from '../gateway/src/services/projects.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'library', 'pipelines');
mkdirSync(outDir, { recursive: true });

for (const pipeline of exportBuiltinPipelines()) {
  const file = join(outDir, `${pipeline.name}.json`);
  writeFileSync(file, JSON.stringify(pipeline, null, 2) + '\n', 'utf-8');
  console.log(`wrote ${file} (${pipeline.steps.length} steps)`);
}
