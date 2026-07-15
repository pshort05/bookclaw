import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LibraryService } from '../../gateway/src/services/library.js';
import { BookService } from '../../gateway/src/services/book.js';
import { parseVerifiedCanonBody } from '../../gateway/src/api/routes/books.routes.js';

const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;
function write(base: string, rel: string, body: string): void {
  const p = join(base, rel); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, body, 'utf-8');
}
async function setup(root: string) {
  const b = join(root, 'library');
  write(b, 'authors/default/SOUL.md', 'soul');
  write(b, 'voices/default/STYLE-GUIDE.md', 'style');
  write(b, 'pipelines/novel-pipeline.json', JSON.stringify({ schemaVersion: 1, name: 'novel-pipeline', label: 'N', description: 'd', dynamic: true, steps: [] }));
  const lib = new LibraryService(b, join(root, 'workspace', 'library'), fakeSkills);
  await lib.loadAll();
  const books = new BookService(join(root, 'workspace', 'books'), lib, '9.9.9');
  await books.initialize();
  return { books };
}

const VERIFIED = {
  status: 'grounded' as const,
  citations: [{ title: 'LBI geography', url: 'https://example.test/lbi' }],
  discrepancies: [{ id: 'd1', premiseClaim: 'town is Bay Haven', finding: 'no such town; it is Surf City', status: 'fail' as const, suggestion: 'use Surf City', targetField: 'setting' as const }],
  dossier: '## Verified Real-World Geography\nSurf City on Long Beach Island; main road Long Beach Boulevard.',
};

test('a plain book has no verifiedCanon block', async () => {
  const root = mkdtempSync(join(tmpdir(), 'canon-persist-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'Plain', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [] });
    assert.equal((m as any).verifiedCanon, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('create persists verifiedCanon to book.json and writes data/verified-canon.md', async () => {
  const root = mkdtempSync(join(tmpdir(), 'canon-persist-'));
  try {
    const { books } = await setup(root);
    const m = await books.create({ title: 'Grounded', author: 'default', voice: 'default', genre: null, pipeline: 'novel-pipeline', sections: [], verifiedCanon: VERIFIED } as any);
    assert.equal((m as any).verifiedCanon.status, 'grounded');
    assert.equal((m as any).verifiedCanon.discrepancies[0].targetField, 'setting');
    assert.equal((m as any).verifiedCanon.citations[0].title, 'LBI geography');
    // dossier is NOT in the manifest (it goes to the .md file), only status/citations/discrepancies
    assert.equal((m as any).verifiedCanon.dossier, undefined);

    const onDisk = JSON.parse(readFileSync(join(root, 'workspace', 'books', m.slug, 'book.json'), 'utf-8'));
    assert.equal(onDisk.verifiedCanon.status, 'grounded');
    const md = readFileSync(join(root, 'workspace', 'books', m.slug, 'data', 'verified-canon.md'), 'utf-8');
    assert.match(md, /Long Beach Boulevard/);
    assert.match(md, /no such town/); // discrepancy ledger rendered
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('parseVerifiedCanonBody accepts a well-formed grounding payload', () => {
  const vc = parseVerifiedCanonBody({
    groundingStatus: 'grounded',
    citations: [{ title: 'x', url: 'https://y.test' }],
    discrepancies: [{ id: 'd1', premiseClaim: 'a', finding: 'b', status: 'fail', suggestion: 's', targetField: 'setting' }],
    settingDossier: '## Verified Real-World Geography\ntext',
  });
  assert.equal(vc?.status, 'grounded');
  assert.equal(vc?.discrepancies[0].targetField, 'setting');
  assert.equal(vc?.dossier, '## Verified Real-World Geography\ntext');
});

test('parseVerifiedCanonBody returns undefined for absent/garbage grounding (backward compatible)', () => {
  assert.equal(parseVerifiedCanonBody({}), undefined);
  assert.equal(parseVerifiedCanonBody({ groundingStatus: 'nope' }), undefined);
  assert.equal(parseVerifiedCanonBody(null), undefined);
});

test('parseVerifiedCanonBody drops a bad discrepancy targetField rather than throwing', () => {
  const vc = parseVerifiedCanonBody({ groundingStatus: 'skipped', discrepancies: [{ id: 'd', premiseClaim: 'a', finding: 'b', status: 'pass', targetField: 'bogus' }] });
  assert.equal(vc?.status, 'skipped');
  assert.equal(vc?.discrepancies[0].targetField, 'setting'); // coerced to default
});
