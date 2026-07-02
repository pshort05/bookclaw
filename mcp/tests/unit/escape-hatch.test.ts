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
