/**
 * Regression tests for mapRunnerPath dot-segment rejection (bug #24).
 *
 * The `.versions/`/`.baseline/` history sidecars live directly under
 * bookDir/data, so a path like `data/.versions/<file>/<versionId>.md` stays
 * inside baseDir and passes `within()` — yet must NOT be reachable by the
 * runner file read/write/restore routes. mapRunnerPath must reject any path
 * whose relative portion contains a dot-prefixed segment (.versions, .baseline,
 * any dotfile/dotdir) or a `..` traversal segment, aligning it with the
 * dotfile filtering listRunnerFiles already performs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mapRunnerPath } from '../../gateway/src/services/runner-files.ts';

const book = '/srv/books/x';

test('mapRunnerPath rejects dot-prefixed segments (version/baseline sidecars)', () => {
  assert.equal(mapRunnerPath(book, 'data/.versions/foo.md/v1.md'), null);
  assert.equal(mapRunnerPath(book, 'data/.baseline/x'), null);
  assert.equal(mapRunnerPath(book, 'templates/.hidden'), null);
  assert.equal(mapRunnerPath(book, 'data/sub/.secret/leak.md'), null);
});

test('mapRunnerPath rejects .. traversal segments', () => {
  assert.equal(mapRunnerPath(book, 'data/../../etc/passwd'), null);
  assert.equal(mapRunnerPath(book, 'data/../book.json'), null);
});

test('mapRunnerPath still maps normal and nested non-dot paths', () => {
  assert.deepEqual(mapRunnerPath(book, 'data/chapter-1.md'), {
    baseDir: join(book, 'data'),
    filename: 'chapter-1.md',
  });
  assert.deepEqual(mapRunnerPath(book, 'data/sub/chapter-2.md'), {
    baseDir: join(book, 'data'),
    filename: 'sub/chapter-2.md',
  });
  assert.deepEqual(mapRunnerPath(book, 'templates/genre/world.md'), {
    baseDir: join(book, 'templates'),
    filename: 'genre/world.md',
  });
});
