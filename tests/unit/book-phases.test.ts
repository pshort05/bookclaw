/**
 * Unit tests for TODO #15 BookService additions: setPhase (the missing
 * post-create writer of book.json `phase`) and phasesForBook (the book's
 * pipeline-derived phase segments for the board).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';
import { NOVEL_PIPELINE_PHASES } from '../../gateway/src/services/library-types.js';

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}
const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;

function seedLibrary(root: string): LibraryService {
  const builtin = join(root, 'library');
  write(builtin, 'authors/default/SOUL.md', 'soul');
  write(builtin, 'authors/default/STYLE-GUIDE.md', 'style');
  write(builtin, 'voices/default/STYLE-GUIDE.md', 'voice style');
  write(builtin, 'pipelines/novel-pipeline.json', JSON.stringify({
    schemaVersion: 1, name: 'novel-pipeline', label: 'Novel', description: 'd', dynamic: true, steps: [],
  }));
  return new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);
}

async function makeBook() {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-phases-'));
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  const m = await svc.create({ title: 'MyBook', author: 'default', voice: 'default', pipeline: 'novel-pipeline', sections: [] });
  return { root, svc, slug: m.slug };
}

test('setPhase writes the phase to book.json so list() reflects it', async () => {
  const { root, svc, slug } = await makeBook();
  try {
    assert.equal(svc.list().find((b) => b.slug === slug)?.phase, 'planning');
    await svc.setPhase(slug, 'production');
    assert.equal(svc.list().find((b) => b.slug === slug)?.phase, 'production');
    const opened = await svc.open(slug);
    assert.equal(opened?.manifest.phase, 'production');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('setPhase is a no-op for an unknown book (fail-soft, no throw)', async () => {
  const { root, svc } = await makeBook();
  try {
    await svc.setPhase('does-not-exist', 'production');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('phasesForBook resolves the snapshotted pipeline (novel-pipeline → canonical phases)', async () => {
  const { root, svc, slug } = await makeBook();
  try {
    assert.deepEqual(svc.phasesForBook(slug), [...NOVEL_PIPELINE_PHASES]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('phasesForBook returns [] when no pipeline resolves (frontend falls back to LIFECYCLE_PHASES)', async () => {
  const { root, svc } = await makeBook();
  try {
    assert.deepEqual(svc.phasesForBook('does-not-exist'), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** A book whose sequence spans two pipelines with distinct, adjacent-dupe phases. */
async function makeSequenceBook() {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-seq-'));
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  const p1 = { schemaVersion: 1, name: 'p1', label: 'P1', description: 'd', steps: [
    { label: 'a', taskType: 'general', promptTemplate: 'x', phase: 'planning' },
    { label: 'b', taskType: 'general', promptTemplate: 'x', phase: 'bible' },
  ] };
  const p2 = { schemaVersion: 1, name: 'p2', label: 'P2', description: 'd', steps: [
    { label: 'c', taskType: 'general', promptTemplate: 'x', phase: 'bible' },   // adjacent-dup with p1's tail
    { label: 'd', taskType: 'general', promptTemplate: 'x', phase: 'writing' },
  ] };
  const m = await svc.create({
    title: 'Seq', author: 'default', voice: 'default', pipeline: 'novel-pipeline', sections: [],
    pipelines: [{ name: 'p1', pipeline: p1 as never }, { name: 'p2', pipeline: p2 as never }],
  });
  return { root, svc, slug: m.slug };
}

test('phasesForBook concatenates phases across the sequence, dedup adjacent only', async () => {
  const { root, svc, slug } = await makeSequenceBook();
  try {
    // p1: [planning, bible] ++ p2: [bible, writing] -> adjacent-dedup -> planning,bible,writing
    assert.deepEqual(svc.phasesForBook(slug), ['planning', 'bible', 'writing']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

/** A book whose sequence is the canonical phase-named pipelines (book-planning, book-bible). */
async function makePhasePipelineBook() {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-phasepipe-'));
  const lib = seedLibrary(root); await lib.loadAll();
  const svc = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  const planning = { schemaVersion: 1, name: 'book-planning', label: 'Planning', description: 'd',
    steps: [{ label: 'Market & genre analysis', taskType: 'general', promptTemplate: 'x' }] };
  const bible = { schemaVersion: 1, name: 'book-bible', label: 'Bible', description: 'd',
    steps: [{ label: 'World-building document', taskType: 'general', promptTemplate: 'x' }] };
  const m = await svc.create({
    title: 'PhasePipe', author: 'default', voice: 'default', pipeline: 'novel-pipeline', sections: [],
    pipelines: [{ name: 'book-planning', pipeline: planning as never }, { name: 'book-bible', pipeline: bible as never }],
  });
  return { root, svc, slug: m.slug };
}

test('readTemplate(pipeline) follows the book phase — bible phase returns book-bible, not the first pipeline', async () => {
  // Regression: the Write view ("Open in Write") rendered book-planning's steps
  // ("Market & genre analysis") even after Planning completed, because readTemplate
  // always defaulted to pipelineSequence[0]. It must default to the current phase.
  const { root, svc, slug } = await makePhasePipelineBook();
  try {
    // Default phase=planning → the planning pipeline.
    let t = svc.readTemplate(slug, 'pipeline');
    assert.ok(t?.content?.includes('Market & genre analysis'), 'planning phase → book-planning');

    await svc.setPhase(slug, 'bible');
    t = svc.readTemplate(slug, 'pipeline');
    assert.ok(t?.content?.includes('World-building document'), 'bible phase → book-bible');
    assert.ok(!t?.content?.includes('Market & genre analysis'), 'must NOT return the completed planning pipeline');

    // An explicit name still wins over the phase default.
    const explicit = svc.readTemplate(slug, 'pipeline', 'book-planning');
    assert.ok(explicit?.content?.includes('Market & genre analysis'), 'explicit name overrides phase');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('setPhase throws on a readonly/quarantined book (assertWritable gate)', async () => {
  const { root, svc, slug } = await makeBook();
  try {
    // Force the book to a too-new schemaVersion -> classifyVersion => 'readonly'.
    const mf = join(root, 'workspace', 'books', slug, 'book.json');
    const m = JSON.parse(readFileSync(mf, 'utf-8'));
    m.schemaVersion = 999;
    writeFileSync(mf, JSON.stringify(m));
    await assert.rejects(() => svc.setPhase(slug, 'production'), /readonly|refusing/i);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
