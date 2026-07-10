/**
 * Bundle smoke test for the "From Premise File" review-gate screen
 * (frontend/studio/src/routes/PremiseIntake.tsx). The Vite dist is gitignored,
 * so this builds it on demand (first run / fresh checkout), then reads every
 * hashed JS asset and asserts stable markers unique to the screen ship in the
 * bundle. This is the repeatable check for a frontend-only feature.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const repo = process.cwd();
const assetsDir = join(repo, 'frontend/studio/dist/assets');

test('studio bundle carries the premise-intake screen', { timeout: 180000 }, () => {
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

  assert.ok(js.includes('/api/books/intake'), 'intake endpoint path must ship in the bundle');
  assert.ok(js.includes('From a premise file'), 'New-hub entry card must ship in the bundle');
  assert.ok(js.includes('Grounded setting'), 'grounded-setting label must ship in the bundle');
});
