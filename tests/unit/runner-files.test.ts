/**
 * Unit tests for the Prompt Runner file helpers:
 *  - listRunnerFiles: lists a book's data/ outputs + templates/ snapshots with
 *    book-root-relative paths, grouped, skipping dotfiles (.versions etc.).
 *  - mapRunnerPath: maps a book-root path (data/… | templates/…) to its base dir
 *    + inner filename, rejecting anything outside those two subtrees or via ../.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listRunnerFiles, mapRunnerPath } from '../../gateway/src/services/runner-files.ts';

function fixtureBook(): string {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-runner-'));
  const book = join(root, 'book');
  mkdirSync(join(book, 'data'), { recursive: true });
  mkdirSync(join(book, 'templates', 'genre'), { recursive: true });
  mkdirSync(join(book, 'data', '.versions', 'chapter-1.md'), { recursive: true }); // sidecar — must be skipped
  writeFileSync(join(book, 'data', 'chapter-1.md'), 'one');
  writeFileSync(join(book, 'data', '.versions', 'chapter-1.md', 'x.md'), 'old');
  writeFileSync(join(book, 'templates', 'genre', 'world.md'), 'genre');
  writeFileSync(join(book, 'book.json'), '{}'); // must NOT be listed
  return book;
}

test('listRunnerFiles lists data/ + templates/ with relative paths and groups', () => {
  const book = fixtureBook();
  try {
    const files = listRunnerFiles(book);
    const byPath = Object.fromEntries(files.map((f) => [f.path, f]));
    assert.equal(byPath['data/chapter-1.md']?.group, 'Outputs');
    assert.equal(byPath['templates/genre/world.md']?.group, 'Templates');
    // dotfile sidecars and book.json are excluded
    assert.ok(!files.some((f) => f.path.includes('.versions')));
    assert.ok(!files.some((f) => f.path === 'book.json'));
  } finally { rmSync(join(book, '..'), { recursive: true, force: true }); }
});

test('mapRunnerPath resolves data/ and templates/ paths', () => {
  const book = '/srv/books/x';
  assert.deepEqual(mapRunnerPath(book, 'data/chapter-1.md'), { baseDir: join(book, 'data'), filename: 'chapter-1.md' });
  assert.deepEqual(mapRunnerPath(book, 'templates/genre/world.md'), { baseDir: join(book, 'templates'), filename: 'genre/world.md' });
});

test('mapRunnerPath rejects non-data/templates paths and traversal', () => {
  const book = '/srv/books/x';
  assert.equal(mapRunnerPath(book, 'book.json'), null);
  assert.equal(mapRunnerPath(book, '.baseline/genre/world.md'), null);
  assert.equal(mapRunnerPath(book, 'data/../book.json'), null);
  assert.equal(mapRunnerPath(book, 'templates/../.vault/x'), null);
  assert.equal(mapRunnerPath(book, ''), null);
});
