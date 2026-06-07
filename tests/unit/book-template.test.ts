/**
 * Unit tests for BookService.readTemplate / writeTemplate (review #8).
 * Covers the singular kind vocabulary enforced by the templates routes (#9/#10).
 * Network-free; runs over real temp dirs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

function seedLibrary(root: string): LibraryService {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', '# Default Author\n\ndefault soul');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'default voice style');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({
    schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [],
  }));
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

async function makeSvc(root: string): Promise<BookService> {
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await svc.initialize();
  return svc;
}

test('writeTemplate(author) then readTemplate(author) → files match', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-tmpl-'));
  try {
    const svc = await makeSvc(root);
    const book = await svc.create({ title: 'T', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    await svc.writeTemplate(book.slug, 'author', undefined, { files: { 'SOUL.md': 'new soul content' } });
    const out = svc.readTemplate(book.slug, 'author');
    assert.ok(out, 'readTemplate returns non-null');
    assert.equal(out!.files?.['SOUL.md'], 'new soul content');
    assert.equal(out!.wired, true); // author is wired
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeTemplate(pipeline) with invalid JSON rejects', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-tmpl-'));
  try {
    const svc = await makeSvc(root);
    const book = await svc.create({ title: 'T', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    await assert.rejects(
      () => svc.writeTemplate(book.slug, 'pipeline', undefined, { content: '{ bad json' }),
      /pipeline content must be|invalid/i,
    );
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeTemplate(section,name) then readTemplate(section,name) and readTemplate(section) list', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-tmpl-'));
  try {
    const svc = await makeSvc(root);
    const book = await svc.create({ title: 'T', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    await svc.writeTemplate(book.slug, 'section', 'epilogue', { content: '# Epilogue\nThe end.' });
    // Read by name
    const byName = svc.readTemplate(book.slug, 'section', 'epilogue');
    assert.ok(byName, 'readTemplate(section, name) returns non-null');
    assert.ok(byName!.content?.includes('# Epilogue'));
    assert.equal(byName!.wired, false); // section is not wired
    // List without name
    const list = svc.readTemplate(book.slug, 'section');
    assert.ok(Array.isArray(list!.entries), 'entries is an array');
    assert.ok(list!.entries!.includes('epilogue'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('readTemplate returns null for a missing section', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-tmpl-'));
  try {
    const svc = await makeSvc(root);
    const book = await svc.create({ title: 'T', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    const out = svc.readTemplate(book.slug, 'section', 'nonexistent');
    assert.equal(out, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('writeTemplate/readTemplate round-trip for a skill', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-tmpl-'));
  try {
    const svc = await makeSvc(root);
    const book = await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    await svc.writeTemplate(book.slug, 'skill', 'my-skill', { files: { 'SKILL.md': '# My Skill\n' } });
    const out = svc.readTemplate(book.slug, 'skill', 'my-skill');
    assert.ok(out && out.files && out.files['SKILL.md'].includes('# My Skill'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
