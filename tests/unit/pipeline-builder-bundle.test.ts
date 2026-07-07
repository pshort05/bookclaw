/**
 * Feature smoke for the visual drag-and-drop pipeline builder: asserts the
 * builder actually SHIPS in the built studio bundle (not just that it
 * type-checks). Catches a real failure mode the logic-level
 * pipeline-builder-flow test can't — the palette/DnD component being dropped
 * from the build, tree-shaken away, or an import breaking so the studio falls
 * back to the plain editor. The Vite dist is gitignored, so build on demand.
 * Run via: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const repo = process.cwd();
const assetsDir = join(repo, 'frontend/studio/dist/assets');

test('the pipeline builder ships in the studio bundle', { timeout: 180000 }, () => {
  if (!existsSync(assetsDir)) {
    try {
      execSync('npm run -w frontend/studio build', { cwd: repo, stdio: 'pipe' });
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      if (e.stdout) process.stderr.write(e.stdout);
      if (e.stderr) process.stderr.write(e.stderr);
      throw err;
    }
  }
  const jsFiles = readdirSync(assetsDir).filter((f) => f.startsWith('index-') && f.endsWith('.js'));
  assert.ok(jsFiles.length > 0, 'a hashed studio JS bundle exists');
  const bundle = jsFiles.map((f) => readFileSync(join(assetsDir, f), 'utf-8')).join('');

  // Palette + drop-zone copy proves the builder UI is present.
  for (const marker of ['Run in parallel', 'Repeat per chapter', 'Step presets', 'Drop a step here']) {
    assert.ok(bundle.includes(marker), `builder UI string "${marker}" is in the bundle`);
  }
  // dnd-kit runtime proves the drag engine is wired in, not tree-shaken.
  assert.ok(/DndContext|activationConstraint/.test(bundle), 'dnd-kit runtime is bundled');
});
