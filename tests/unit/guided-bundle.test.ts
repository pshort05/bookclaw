/**
 * Bundle smoke test for the Guided wizard screen
 * (frontend/studio/src/routes/Guided.tsx). Mirrors
 * tests/unit/premise-intake-bundle.test.ts: the Vite dist is gitignored, so
 * this builds it on demand (first run / fresh checkout), then reads every
 * hashed JS asset and asserts markers unique to the Guided screen ship.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const repo = process.cwd();
const assetsDir = join(repo, 'frontend/studio/dist/assets');

test('studio bundle carries the Guided wizard screen', { timeout: 180000 }, () => {
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

  // These three strings are unique to Guided.tsx — PremiseIntake.tsx has no
  // council-selection UI and no chef/critic placeholder copy.
  assert.ok(js.includes('Auto-select the best base story'), 'council-selection auto label must ship in the bundle');
  assert.ok(js.includes('Propose top ideas for me to pick'), 'council-selection propose label must ship in the bundle');
  assert.ok(js.includes('the critic who once panned her restaurant'), 'story-arc placeholder copy must ship in the bundle');
});
