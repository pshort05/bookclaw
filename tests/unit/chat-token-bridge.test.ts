/**
 * Chat token-bridge injection (init/phase-12-chat-http.ts ⇆ frontend/chat/index.html).
 *
 * Regression guard for the bug that broke the Chat app from 6i until 2026-06-12:
 * the API-base PLACEHOLDER shared its name with the window VARIABLE, so the
 * serve-time replaceAll rewrote the assignment target itself
 * (`window.http://host='http://host'`) — a syntax error that killed the whole
 * inline script, token assignment included. These tests simulate the server's
 * exact replaceAll sequence over the real template and assert the result is a
 * sane script.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE = readFileSync(join(ROOT, 'frontend', 'chat', 'index.html'), 'utf-8');

// Mirror of the replace sequence in gateway/src/init/phase-12-chat-http.ts.
function inject(html: string, token: string, origin: string): string {
  return html
    .replaceAll('__BOOKCLAW_AUTH_TOKEN__', token)
    .replaceAll('__BOOKCLAW_API_BASE_URL__', origin);
}

describe('chat token bridge', () => {
  const out = inject(TEMPLATE, 'tok-123', 'http://192.168.1.32:3847');

  test('template carries both placeholders, each distinct from its window variable', () => {
    assert.ok(TEMPLATE.includes("'__BOOKCLAW_AUTH_TOKEN__'"));
    assert.ok(TEMPLATE.includes("'__BOOKCLAW_API_BASE_URL__'"));
    // The variable names must survive injection — so neither may equal a placeholder.
    assert.ok(TEMPLATE.includes('window.__BOOKCLAW_TOKEN__='));
    assert.ok(TEMPLATE.includes('window.__BOOKCLAW_API_BASE__='));
  });

  test('injection fills values and leaves no placeholder behind', () => {
    assert.ok(out.includes("window.__BOOKCLAW_TOKEN__='tok-123'"));
    assert.ok(out.includes("window.__BOOKCLAW_API_BASE__='http://192.168.1.32:3847'"));
    assert.ok(!out.includes('__BOOKCLAW_AUTH_TOKEN__'));
    assert.ok(!out.includes('__BOOKCLAW_API_BASE_URL__'));
  });

  test('assignment targets are intact (no window.http:// mangling)', () => {
    assert.ok(!/window\.http/.test(out));
    // Both assignments must remain syntactically shaped: window.NAME='VALUE';
    const script = out.match(/<script>([^<]*)<\/script>/)?.[1] ?? '';
    assert.match(script, /^window\.__BOOKCLAW_TOKEN__='[^']*';window\.__BOOKCLAW_API_BASE__='[^']*';$/);
  });
});
