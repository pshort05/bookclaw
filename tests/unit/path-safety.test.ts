/**
 * Unit tests for the consolidated path-safety helpers (feature #15).
 *
 * Ports the AuthorAgent fork's resolveWithin / safeResolveWithin /
 * sanitizeSegment matrix to node:test, PLUS a load-bearing regression that
 * proves SandboxGuard's realpath symlink-escape defence survived the refactor
 * onto the shared helpers (the fork DROPPED that defence — BookClaw keeps it).
 *
 * Run: node --import tsx --test tests/unit/path-safety.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveWithin, safeResolveWithin, sanitizeSegment } from '../../gateway/src/security/paths.js';
import { SandboxGuard } from '../../gateway/src/security/sandbox.js';

// Portable absolute base (posix -> /workspace/project; win32 -> <drive>\workspace\project).
const base = resolve('/workspace/project');

// --- resolveWithin -------------------------------------------------------

test('resolveWithin joins a normal single segment inside the base', () => {
  assert.equal(resolveWithin(base, 'file.txt'), join(base, 'file.txt'));
});

test('resolveWithin joins multiple normal segments inside the base', () => {
  assert.equal(resolveWithin(base, 'sub', 'dir', 'file.txt'), join(base, 'sub', 'dir', 'file.txt'));
});

test('resolveWithin returns the base itself when no segments are given', () => {
  assert.equal(resolveWithin(base), base);
});

test('resolveWithin allows a segment that resolves back to exactly the base', () => {
  assert.equal(resolveWithin(base, '.'), base);
});

test('resolveWithin blocks simple ../ traversal', () => {
  assert.throws(() => resolveWithin(base, '..', 'outside.txt'), /Path escapes base directory/);
});

test('resolveWithin blocks nested ../../ traversal', () => {
  assert.throws(() => resolveWithin(base, 'a', '..', '..', 'etc', 'passwd'), /Path escapes base directory/);
});

test('resolveWithin blocks traversal using forward slashes', () => {
  assert.throws(() => resolveWithin(base, '../secrets.txt'), /Path escapes base directory/);
});

test('resolveWithin blocks traversal embedded in a single segment with mixed slashes', () => {
  assert.throws(() => resolveWithin(base, 'sub/../../escape'), /Path escapes base directory/);
});

test('resolveWithin blocks a sibling directory that shares a string prefix with base', () => {
  // base = /workspace/project, sibling = /workspace/project-evil.
  // A naive startsWith(base) check (no trailing separator) would wrongly allow this.
  const sibling = base + '-evil';
  assert.throws(() => resolveWithin(base, '..', 'project-evil', 'file.txt'));
  assert.equal(resolve(base, '..', 'project-evil'), sibling);
});

test('resolveWithin rejects null bytes in a segment', () => {
  assert.throws(() => resolveWithin(base, 'file\x00.txt'), /Path contains null byte/);
});

test('resolveWithin rejects null bytes even in a later segment', () => {
  assert.throws(() => resolveWithin(base, 'ok', 'bad\x00'), /Path contains null byte/);
});

test('resolveWithin rejects non-string segments', () => {
  // @ts-expect-error intentional bad input for runtime guard test
  assert.throws(() => resolveWithin(base, 123), /Path segment must be a string/);
});

test('resolveWithin preserves original casing/separators of the resolved result', () => {
  assert.equal(resolveWithin(base, 'MixedCase', 'File.TXT'), join(base, 'MixedCase', 'File.TXT'));
});

// --- safeResolveWithin ---------------------------------------------------

test('safeResolveWithin returns the resolved path for a safe segment', () => {
  assert.equal(safeResolveWithin(base, 'ok.txt'), join(base, 'ok.txt'));
});

test('safeResolveWithin returns null instead of throwing on traversal', () => {
  assert.equal(safeResolveWithin(base, '..', 'outside.txt'), null);
});

test('safeResolveWithin returns null instead of throwing on null byte', () => {
  assert.equal(safeResolveWithin(base, 'bad\x00.txt'), null);
});

// --- sanitizeSegment -----------------------------------------------------

test('sanitizeSegment preserves a normal filename unchanged', () => {
  assert.equal(sanitizeSegment('chapter-one.docx'), 'chapter-one.docx');
});

test('sanitizeSegment preserves normal names with spaces', () => {
  assert.equal(sanitizeSegment('My Manuscript Draft.txt'), 'My Manuscript Draft.txt');
});

test('sanitizeSegment strips forward slashes', () => {
  assert.equal(sanitizeSegment('a/b/c'), 'a_b_c');
});

test('sanitizeSegment strips backslashes', () => {
  assert.equal(sanitizeSegment('a\\b\\c'), 'a_b_c');
});

test('sanitizeSegment strips mixed slashes', () => {
  assert.equal(sanitizeSegment('a/b\\c'), 'a_b_c');
});

test('sanitizeSegment collapses ".." runs and falls back on the all-underscore result', () => {
  assert.equal(sanitizeSegment('..'), 'file');
});

test('sanitizeSegment falls back on a dots-only name', () => {
  assert.equal(sanitizeSegment('...'), 'file');
});

test('sanitizeSegment falls back on an empty string', () => {
  assert.equal(sanitizeSegment(''), 'file');
});

test('sanitizeSegment falls back on whitespace-only input', () => {
  assert.equal(sanitizeSegment('   '), 'file');
});

test('sanitizeSegment respects a custom fallback', () => {
  assert.equal(sanitizeSegment('', 'default-name'), 'default-name');
  assert.equal(sanitizeSegment('...', 'default-name'), 'default-name');
});

test('sanitizeSegment strips null bytes and control characters', () => {
  assert.equal(sanitizeSegment('a\x00b\x01c.txt'), 'abc.txt');
});

test('sanitizeSegment strips Windows-illegal characters', () => {
  assert.equal(sanitizeSegment('a:b*c?d"e<f>g|h'), 'a_b_c_d_e_f_g_h');
});

test('sanitizeSegment strips leading dots (hidden file style)', () => {
  assert.equal(sanitizeSegment('.hidden'), 'hidden');
});

test('sanitizeSegment rejects reserved Windows device name CON', () => {
  assert.equal(sanitizeSegment('CON'), 'file');
});

test('sanitizeSegment rejects reserved Windows device name CON regardless of case', () => {
  assert.equal(sanitizeSegment('con'), 'file');
  assert.equal(sanitizeSegment('CoN'), 'file');
});

test('sanitizeSegment rejects reserved Windows device name PRN with an extension', () => {
  assert.equal(sanitizeSegment('PRN.txt'), 'file');
});

test('sanitizeSegment rejects reserved Windows device names AUX and NUL', () => {
  assert.equal(sanitizeSegment('AUX'), 'file');
  assert.equal(sanitizeSegment('NUL'), 'file');
  assert.equal(sanitizeSegment('nul.txt'), 'file');
});

test('sanitizeSegment rejects reserved Windows device names COM1-9 and LPT1-9', () => {
  for (let n = 1; n <= 9; n++) {
    assert.equal(sanitizeSegment(`COM${n}`), 'file');
    assert.equal(sanitizeSegment(`lpt${n}.txt`), 'file');
  }
});

test('sanitizeSegment does not reject names that merely contain a reserved word', () => {
  // base name before the first dot is "console", not "con" — must NOT be rejected.
  assert.equal(sanitizeSegment('console.txt'), 'console.txt');
});

test('sanitizeSegment caps length at 200 characters', () => {
  assert.equal(sanitizeSegment('a'.repeat(300)).length, 200);
});

test('sanitizeSegment coerces null/undefined input via String(name ?? "")', () => {
  // @ts-expect-error intentional bad input for runtime guard test
  assert.equal(sanitizeSegment(null), 'file');
  // @ts-expect-error intentional bad input for runtime guard test
  assert.equal(sanitizeSegment(undefined), 'file');
});

// --- LOAD-BEARING regression: realpath symlink defence preserved ---------

test('SandboxGuard.validatePath still blocks an in-workspace symlink that escapes the workspace', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'bookclaw-sbx-'));
  const outside = mkdtempSync(join(tmpdir(), 'bookclaw-out-'));
  try {
    // A symlink that lives INSIDE the workspace but points OUTSIDE it. The
    // lexical boundary check passes (link/... looks in-workspace); only the
    // realpath defence catches the escape.
    symlinkSync(outside, join(workspace, 'link'), 'dir');

    const guard = new SandboxGuard(workspace);

    // Control: an ordinary in-workspace path is accepted.
    const ok = guard.validatePath('notes.txt');
    assert.equal(ok.valid, true, 'ordinary in-workspace path should be valid');

    // The escape-through-symlink must be rejected with a symlink/escape reason.
    const escaped = guard.validatePath(join('link', 'secret.txt'));
    assert.equal(escaped.valid, false, 'symlink escape must be rejected');
    assert.match(escaped.reason ?? '', /symlink|escape/i);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
