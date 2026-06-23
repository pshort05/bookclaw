/**
 * Unit tests for the route _shared.ts path/serve security primitives
 * (gateway/src/api/routes/_shared.ts):
 *   - safePath(base, userInput): returns the resolved path only when it stays
 *     within base (the base itself or a descendant), else null. Covers ../
 *     traversal, encoded-looking input, absolute paths, and valid names.
 *   - serveFile(res, ...): chooses inert (text/plain inline) vs active
 *     (octet-stream attachment) headers + always nosniff, and strips
 *     CR/LF/quote from the attachment filename (header-injection guard).
 *
 * Characterization: asserts ACTUAL current behavior of the code.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'stream';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join, sep } from 'path';
import { tmpdir } from 'os';
import { safePath, serveFile } from '../../gateway/src/api/routes/_shared.js';

describe('safePath', () => {
  const base = '/srv/app/workspace';

  test('a plain valid name resolves under the base', () => {
    const r = safePath(base, 'books/alpha.md');
    assert.equal(r, join(base, 'books/alpha.md'));
    assert.ok(r!.startsWith(base + sep));
  });

  test('the base itself (empty input) is allowed and returns the base', () => {
    assert.equal(safePath(base, ''), base);
    assert.equal(safePath(base, '.'), base);
  });

  test('../ traversal that escapes the base returns null', () => {
    assert.equal(safePath(base, '../../etc/passwd'), null);
  });

  test('a single ../ that lands on a sibling of base returns null', () => {
    // resolves to /srv/app/secrets — not base and not under base+sep
    assert.equal(safePath(base, '../secrets'), null);
  });

  test('an absolute path outside the base returns null', () => {
    assert.equal(safePath(base, '/etc/passwd'), null);
  });

  test('an absolute path INSIDE the base is accepted (path.resolve honors leading /)', () => {
    // NOTE: path.resolve(base, '/srv/app/workspace/x') === '/srv/app/workspace/x'
    // because the absolute arg replaces base; it still passes the containment check.
    const inside = join(base, 'x');
    assert.equal(safePath(base, inside), inside);
  });

  test('an encoded "..%2f" is NOT decoded — treated as a literal filename under base', () => {
    // safePath does no URL-decoding; the literal stays inside the base.
    const r = safePath(base, '..%2f..%2fetc');
    assert.equal(r, join(base, '..%2f..%2fetc'));
    assert.ok(r!.startsWith(base + sep));
  });

  test('embedded ../ inside a longer path still escapes and returns null', () => {
    assert.equal(safePath(base, 'books/../../../root'), null);
  });

  test('a prefix-collision sibling directory is rejected (boundary uses base+sep)', () => {
    // base + '-evil' shares the string prefix of base but is NOT inside it.
    assert.equal(safePath('/srv/app/ws', '../ws-evil/x'), null);
  });
});

/** Minimal Express-Response stand-in: a Writable sink that records headers. */
function makeRes() {
  const headers: Record<string, string> = {};
  const res = new Writable({ write(_chunk, _enc, cb) { cb(); } }) as any;
  res.setHeader = (k: string, v: string) => { headers[k] = v; };
  res.headers = headers;
  return res as { headers: Record<string, string>; on: any; once: any } & any;
}

/** Resolve once the response Writable has fully consumed the piped file. */
function waitFinish(res: any): Promise<void> {
  return new Promise((resolve, reject) => {
    res.on('finish', resolve);
    res.on('error', reject);
  });
}

describe('serveFile header selection', () => {
  let dir: string;
  let file: string;
  const CONTENT = 'hello world contents';

  test('setup temp file', () => {
    dir = mkdtempSync(join(tmpdir(), 'bc-serve-'));
    file = join(dir, 'src');
    writeFileSync(file, CONTENT);
    assert.ok(file);
  });

  test('previewable text (.md) is served inline as text/plain, no Content-Disposition', async () => {
    const res = makeRes();
    const done = waitFinish(res);
    await serveFile(res, file, 'note.md', false);
    await done;
    assert.equal(res.headers['Content-Type'], 'text/plain; charset=utf-8');
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(res.headers['Content-Disposition'], undefined);
  });

  test('non-previewable extension (.docx) is forced to octet-stream attachment', async () => {
    const res = makeRes();
    const done = waitFinish(res);
    await serveFile(res, file, 'manuscript.docx', false);
    await done;
    assert.equal(res.headers['Content-Type'], 'application/octet-stream');
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
    assert.match(res.headers['Content-Disposition'], /^attachment; filename="manuscript\.docx"$/);
  });

  test('download=true forces attachment even for previewable text', async () => {
    const res = makeRes();
    const done = waitFinish(res);
    await serveFile(res, file, 'note.md', true);
    await done;
    assert.equal(res.headers['Content-Type'], 'application/octet-stream');
    assert.match(res.headers['Content-Disposition'], /filename="note\.md"$/);
  });

  test('an .html upload is NEVER served as active text/html (XSS guard)', async () => {
    const res = makeRes();
    const done = waitFinish(res);
    await serveFile(res, file, 'evil.html', false);
    await done;
    assert.equal(res.headers['Content-Type'], 'application/octet-stream');
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  });

  test('CR/LF/quote in the filename are stripped from the attachment header', async () => {
    const res = makeRes();
    const done = waitFinish(res);
    await serveFile(res, file, 'a"b\r\nSet-Cookie: x.docx', false);
    await done;
    // Quotes and CR/LF removed -> no header injection / no broken quoting.
    assert.equal(res.headers['Content-Disposition'], 'attachment; filename="abSet-Cookie: x.docx"');
  });

  test('cleanup temp dir', () => {
    rmSync(dir, { recursive: true, force: true });
    assert.ok(true);
  });
});
