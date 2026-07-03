import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePath } from '../../src/tools/escape-hatch.js';

test('rejects a path that does not start with /api/', () => {
  assert.match(validatePath('/etc/passwd') ?? '', /must start with \/api\//);
});

test('rejects a protocol-relative or absolute URL', () => {
  assert.notEqual(validatePath('http://evil.example/api/x'), null);
});

test('rejects a path with .. segments that would escape /api/', () => {
  // These normalize out of the /api/ namespace (/admin, /secret) and are rejected.
  assert.notEqual(validatePath('/api/../admin'), null);
  assert.notEqual(validatePath('/api/books/../../secret'), null);
});

test('rejects percent-encoded / backslash dot-segment bypasses of the confirmation gate (finding 11)', () => {
  // fetch/WHATWG-URL normalizes these to /api/confirmations/123/approve on the
  // wire; the guard runs on the RAW string before, so it must normalize first.
  assert.notEqual(validatePath('/api/confirmations/123/foo/%2e%2e/approve'), null);
  assert.notEqual(validatePath('/api/confirmations/123/foo/%2E%2E/reject'), null);
  assert.notEqual(validatePath('/api/confirmations/123/x/..\\approve'), null);
});

test('accepts a normal api path', () => {
  assert.equal(validatePath('/api/books'), null);
});

test('rejects approving/rejecting the confirmation gate (no self-approval via the escape hatch)', () => {
  assert.match(validatePath('/api/confirmations/abc123/approve') ?? '', /confirmation/i);
  assert.match(validatePath('/api/confirmations/abc123/reject') ?? '', /confirmation/i);
  assert.match(validatePath('/api/confirmations/abc/approve?x=1') ?? '', /confirmation/i);
  // Case-insensitive: Express routes are case-insensitive, so the guard must be too.
  assert.match(validatePath('/api/confirmations/abc/APPROVE') ?? '', /confirmation/i);
  assert.match(validatePath('/api/Confirmations/abc/approve') ?? '', /confirmation/i);
  // Listing pending confirmations is still allowed.
  assert.equal(validatePath('/api/confirmations'), null);
});

test('rejects resolving a Human Review pipeline gate via review/action (same human-in-the-loop rail)', () => {
  // POST /api/projects/:id/review/action resolves the Plan 5 human-review gate
  // (action=approve/edit/regenerate/stop) AND the underlying Confirmations
  // request — a second path to self-approve a gated action that the /api/
  // confirmations guard alone doesn't cover. A human resolves review gates in
  // the dashboard, so the escape hatch must not.
  assert.match(validatePath('/api/projects/p1/review/action') ?? '', /human review/i);
  assert.match(validatePath('/api/projects/p1/review/action?x=1') ?? '', /human review/i);
  // Case-insensitive + dot-segment bypasses normalize to the same route.
  assert.match(validatePath('/api/Projects/p1/REVIEW/Action') ?? '', /human review/i);
  assert.match(validatePath('/api/projects/p1/foo/%2e%2e/review/action') ?? '', /human review/i);
  // Reading project state is still allowed.
  assert.equal(validatePath('/api/projects/p1'), null);
});
