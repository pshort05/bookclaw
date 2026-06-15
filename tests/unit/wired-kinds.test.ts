/**
 * Unit tests for sections/skills wiring (config-not-code pipelines, Tasks 11/12):
 * - WIRED_KINDS now includes 'section' and 'skill'.
 * - BookService.sectionsOf(slug) concatenates templates/sections/*.md into one
 *   labelled block (skipping *.meta.json); '' / null when none.
 * - BookService.skillContentOf(slug, name) prefers the book's snapshotted
 *   templates/skills/<name>/SKILL.md; null when absent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WIRED_KINDS } from '../../gateway/src/services/book-types.js';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}
const fakeSkills = {
  getSkillCatalog: () => [],
  getSkillByName: (name: string) =>
    name === 'write' ? { content: 'WRITE SKILL CONTENT', description: '', source: 'builtin' } : undefined,
} as never;

function seedLibrary(root: string): LibraryService {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', 'soul');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'voice');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'N', description: 'd', dynamic: true, steps: [] }));
  write(builtin, 'sections/front-matter.md', 'FRONT BODY');
  write(builtin, 'sections/back-matter.md', 'BACK BODY');
  write(builtin, 'skills/write/SKILL.md', 'WRITE SKILL CONTENT');
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

test('WIRED_KINDS includes section and skill', () => {
  assert.ok(WIRED_KINDS.has('section'));
  assert.ok(WIRED_KINDS.has('skill'));
});

test('sectionsOf concatenates snapshotted sections into one labelled block', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-wired-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    const m = await svc.create({ title: 'Sec', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: ['front-matter', 'back-matter'] });
    const block = svc.sectionsOf(m.slug);
    assert.ok(block);
    assert.ok(block!.includes('FRONT BODY'));
    assert.ok(block!.includes('BACK BODY'));
    assert.ok(block!.includes('front-matter') || block!.includes('Front'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('sectionsOf returns null when no sections snapshotted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-wired-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    const m = await svc.create({ title: 'NoSec', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.equal(svc.sectionsOf(m.slug), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('skillContentOf prefers the book snapshot, null when absent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-wired-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    // A pipeline referencing skill 'write' snapshots its SKILL.md into the book.
    const pipe = { schemaVersion: 1, name: 'p', label: 'P', description: 'd', steps: [
      { label: 'w', skill: 'write', taskType: 'creative_writing', promptTemplate: 'x', phase: 'writing' },
    ] };
    const m = await svc.create({
      title: 'Sk', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [],
      pipelines: [{ name: 'p', pipeline: pipe as never }],
    });
    assert.equal(svc.skillContentOf(m.slug, 'write'), 'WRITE SKILL CONTENT');
    assert.equal(svc.skillContentOf(m.slug, 'nope'), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
