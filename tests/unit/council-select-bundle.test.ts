/**
 * Bundle smoke test for the LLM Council candidate-review screen
 * (frontend/studio/src/routes/CouncilSelect.tsx). Mirrors
 * tests/unit/premise-intake-bundle.test.ts / guided-bundle.test.ts: the Vite
 * dist is gitignored, so this builds it on demand (first run / fresh
 * checkout), then reads every hashed JS asset and asserts markers unique to
 * the CouncilSelect screen ship in the bundle.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const repo = process.cwd();
const assetsDir = join(repo, 'frontend/studio/dist/assets');

test('studio bundle carries the CouncilSelect screen', { timeout: 180000 }, () => {
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
  const js = readdirSync(assetsDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(assetsDir, f), 'utf-8'))
    .join('\n');

  // These strings are unique to CouncilSelect.tsx — no other screen renders
  // the recommendation badge, the confirm CTA, or the council fetch path.
  assert.ok(js.includes('AI recommendation'), 'recommendation badge must ship in the bundle');
  assert.ok(js.includes('Use this base story & continue'), 'confirm CTA must ship in the bundle');
  assert.ok(js.includes('No base-story selection pending for this project'), '404 empty-state copy must ship in the bundle');
});
