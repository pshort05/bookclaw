/**
 * Build-artifact test for the Phase 6 React studio (sub-phase 6a). The Vite dist
 * is gitignored, so this builds it on demand (first run / fresh checkout) and then
 * asserts the served HTML still carries the auth-token placeholder the gateway
 * injects at request time, plus a hashed module entry. Run via: npm run test:unit
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const repo = process.cwd();
const distHtml = join(repo, 'frontend/studio/dist/index.html');

test('studio build carries the token placeholder + hashed module entry', { timeout: 180000 }, () => {
  if (!existsSync(distHtml)) {
    // Build on demand (dist is gitignored). Capture output and surface it on
    // failure so a broken build is diagnosable from the test run, not opaque.
    try {
      execSync('npm run -w frontend/studio build', { cwd: repo, stdio: 'pipe' });
    } catch (err) {
      const e = err as { stdout?: Buffer; stderr?: Buffer };
      if (e.stdout) process.stderr.write(e.stdout);
      if (e.stderr) process.stderr.write(e.stderr);
      throw err;
    }
  }
  const html = readFileSync(distHtml, 'utf-8');
  assert.ok(html.includes('__BOOKCLAW_AUTH_TOKEN__'), 'token placeholder must survive the build');
  assert.match(html, /<script type="module"[^>]*src="\/assets\/[^"]+\.js"/, 'hashed module entry referenced');
});
