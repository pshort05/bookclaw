import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTree } from '../../frontend/studio/src/lib/fileTree.js';

test('buildTree nests book paths and adds a Documents root', () => {
  const tree = buildTree(
    [{ path: 'data/manuscript.md' }, { path: 'templates/genre/world.md' }, { path: 'templates/author/SOUL.md' }],
    [{ filename: 'notes.txt' }],
  );
  // Documents root first, then data/, templates/ (dirs before files, alphabetical)
  assert.deepEqual(tree.map((n) => n.name), ['Documents', 'data', 'templates']);
  const templates = tree.find((n) => n.name === 'templates')!;
  assert.deepEqual(templates.children!.map((c) => c.name).sort(), ['author', 'genre']);
  const genre = templates.children!.find((c) => c.name === 'genre')!;
  assert.equal(genre.children![0].path, 'templates/genre/world.md');
  assert.equal(genre.children![0].kind, 'file');
  const docs = tree.find((n) => n.name === 'Documents')!;
  assert.equal(docs.source, 'documents');
  assert.equal(docs.children![0].path, 'notes.txt');
});
