/**
 * Bundle smoke test for the Adaptive Interview screen
 * (frontend/studio/src/routes/AdaptiveInterview.tsx). Mirrors
 * tests/unit/premise-intake-bundle.test.ts: the Vite dist is gitignored, so
 * this builds it on demand (first run / fresh checkout), then reads every
 * hashed JS asset and asserts markers unique to the Adaptive screen ship.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const repo = process.cwd();
const assetsDir = join(repo, 'frontend/studio/dist/assets');

test('studio bundle carries the Adaptive Interview screen', { timeout: 180000 }, () => {
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

  assert.ok(js.includes('/api/romance/interview'), 'interview endpoint path must ship in the bundle');
  assert.ok(js.includes('/adaptive'), 'NewHub Adaptive card must route to /adaptive');
  assert.ok(js.includes('Auto-Select Best Story'), 'council toggle label must ship in the bundle');
});
