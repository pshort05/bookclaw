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
    execSync('npm run -w frontend/studio build', { cwd: repo, stdio: 'ignore' });
  }
  const html = readFileSync(distHtml, 'utf-8');
  assert.ok(html.includes('__BOOKCLAW_AUTH_TOKEN__'), 'token placeholder must survive the build');
  assert.match(html, /<script type="module"[^>]*src="\/assets\/[^"]+\.js"/, 'hashed module entry referenced');
});
