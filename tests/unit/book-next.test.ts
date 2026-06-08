/**
 * Unit tests for Phase 6e:
 *  - BookService snapshots asset descriptions into templates/ (Task 3)
 *  - suggestedNextStep pure function + BookService.nextStep() (Task 4)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';
import { suggestedNextStep } from '../../gateway/src/services/book-types.js';

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function seedLibrary(root: string): LibraryService {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', 'default soul');
  write(builtin, 'authors/default/STYLE-GUIDE.md', 'default style');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'default voice style');
  write(builtin, 'genres/romantasy/tropes.md', 'romantasy tropes');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [] }));
  write(builtin, 'sections/front-matter.md', 'FRONT');
  write(builtin, 'sections/back-matter.md', 'BACK');
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

// ── Task 3: description snapshot ─────────────────────────────────────────────

test('book snapshots the asset description and readTemplate returns it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-booknext-'));
  try {
    const lib = seedLibrary(root);
    write(join(root, 'library'), 'genres/romantasy/meta.json', JSON.stringify({ description: 'Dragons + romance.' }));
    await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.create({ title: 'B', author: 'default', voice: 'default', genre: 'romantasy', pipeline: 'novel-pipeline', sections: ['front-matter'] });
    const t = svc.readTemplate('b', 'genre');
    assert.equal(t?.description, 'Dragons + romance.');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── Task 4: suggestedNextStep pure function + BookService.nextStep() ──────────

test('suggestedNextStep maps every phase to a label/hint', () => {
  for (const p of ['planning', 'bible', 'production', 'revision', 'format', 'launch'] as const) {
    const s = suggestedNextStep(p, false);
    assert.ok(s.label.length > 0 && s.hint.length > 0, `phase ${p} has copy`);
  }
  assert.notEqual(suggestedNextStep('production', false).hint, suggestedNextStep('production', true).hint);
});

test('BookService.nextStep reports hasOutput from the data dir', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-booknext-'));
  try {
    const lib = seedLibrary(root); await lib.loadAll();
    const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
    await svc.create({ title: 'B', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    let n = svc.nextStep('b');
    assert.equal(n?.hasOutput, false);
    // drop a file into data/
    writeFileSync(join(root, 'workspace', 'books', 'b', 'data', 'x.md'), 'hi');
    n = svc.nextStep('b');
    assert.equal(n?.hasOutput, true);
    assert.equal(n?.phase, 'planning');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
