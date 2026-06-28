import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUploadableName, resolveBookUpload } from '../../gateway/src/services/runner-files.js';

test('isUploadableName allows text kinds only', () => {
  for (const ok of ['a.md', 'a.txt', 'a.json', 'a.csv', 'A.MD']) assert.equal(isUploadableName(ok), true, ok);
  for (const no of ['a.docx', 'a.png', 'a', 'a.exe']) assert.equal(isUploadableName(no), false, no);
});

test('resolveBookUpload confines to data/ and templates/', () => {
  const book = '/books/x';
  assert.deepEqual(resolveBookUpload(book, 'data', 'ch1.md'), { baseDir: '/books/x/data', filename: 'ch1.md' });
  assert.deepEqual(resolveBookUpload(book, 'templates/genre', 'g.md'), { baseDir: '/books/x/templates', filename: 'genre/g.md' });
  assert.deepEqual(resolveBookUpload(book, 'data/', 'ch1.md'), { baseDir: '/books/x/data', filename: 'ch1.md' }); // trailing slash tolerated
  assert.equal(resolveBookUpload(book, 'config', 'x.md'), null);     // not data/templates
  assert.equal(resolveBookUpload(book, 'data/../..', 'x.md'), null); // traversal via dir
  assert.equal(resolveBookUpload(book, 'data', '../escape.md'), null); // traversal via name
});
