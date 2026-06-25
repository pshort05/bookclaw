/**
 * Unit tests for SandboxGuard (gateway/src/security/sandbox.ts): constrains all
 * file access to the workspace root. Covers in-workspace paths (valid), ../
 * traversal escaping the root (invalid), absolute paths outside the root
 * (invalid), the forbidden patterns (.env, .vault, node_modules), and
 * sanitizeFilename dangerous-char stripping.
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SandboxGuard } from '../../gateway/src/security/sandbox.js';

describe('SandboxGuard', () => {
  let root: string;
  let guard: SandboxGuard;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bc-sandbox-'));
    guard = new SandboxGuard(root);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('a relative path inside the workspace is valid and resolves under the root', () => {
    const r = guard.validatePath('books/alpha/draft.md');
    assert.equal(r.valid, true);
    assert.ok(r.resolved);
    assert.ok(r.resolved!.startsWith(root));
  });

  test('the workspace root itself is valid', () => {
    assert.equal(guard.validatePath('.').valid, true);
  });

  test('../ traversal that escapes the root is invalid', () => {
    const r = guard.validatePath('../../etc/passwd');
    assert.equal(r.valid, false);
    assert.ok(r.reason);
  });

  test('an absolute path outside the root is invalid', () => {
    const r = guard.validatePath('/etc/passwd');
    assert.equal(r.valid, false);
    assert.ok(r.reason);
  });

  test('the .env forbidden pattern is rejected even inside the workspace', () => {
    const r = guard.validatePath('config/.env');
    assert.equal(r.valid, false);
    assert.match(r.reason!, /forbidden/i);
  });

  test('the .vault forbidden pattern is rejected', () => {
    const r = guard.validatePath('.vault/vault.enc');
    assert.equal(r.valid, false);
    assert.match(r.reason!, /forbidden/i);
  });

  test('node_modules is rejected', () => {
    const r = guard.validatePath('node_modules/evil/index.js');
    assert.equal(r.valid, false);
    assert.match(r.reason!, /forbidden/i);
  });

  test('a symlink inside the workspace pointing outside is rejected (realpath escape)', () => {
    // Create an external target dir and a symlink under the workspace root that
    // points at it. The lexical path stays under the root, but realpath escapes.
    const outside = mkdtempSync(join(tmpdir(), 'bc-outside-'));
    try {
      symlinkSync(outside, join(root, 'escape'), 'dir');
      const r = guard.validatePath('escape/secret.txt');
      assert.equal(r.valid, false, 'symlink escape should be rejected');
      assert.ok(r.reason);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test('a path under a real (non-symlink) subdir resolves valid', () => {
    mkdirSync(join(root, 'books', 'alpha'), { recursive: true });
    const r = guard.validatePath('books/alpha/new-file.md');
    assert.equal(r.valid, true, r.reason);
  });

  test('sanitizeFilename replaces path separators and dangerous chars', () => {
    const out = guard.sanitizeFilename('a/b\\c:d*e?f"g<h>i|j.txt');
    assert.ok(!/[<>:"/\\|?*]/.test(out), `sanitized name still has dangerous chars: ${out}`);
  });

  test('sanitizeFilename collapses repeated dots (defeats ".." in names) and caps length', () => {
    assert.ok(!guard.sanitizeFilename('..hidden').includes('..'));
    assert.ok(guard.sanitizeFilename('x'.repeat(400)).length <= 255);
  });
});
