/**
 * VERIFIED Low bug #36 (seven small sub-parts). TDD coverage for the
 * cleanly-testable sub-bugs: (a) typo'd {{var}} silently blanking, (b) a
 * provider-throttle limit of 0 deadlocking, (c) nondeterministic canon file
 * selection, (d) unvalidated pipeline JSON on library load, (e) UTC-vs-local
 * daily cost reset, (f) a burned slug after a create() failure. (g) is
 * reviewed-and-skipped (see report) — no test here.
 *
 * Run: node --import tsx --test tests/unit/misc-low-fixes.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { interpolate } from '../../gateway/src/services/pipeline-expand.ts';
import { ProviderThrottle } from '../../gateway/src/services/pipeline/provider-throttle.ts';
import { buildBookCanonBlock, pickCanonFile } from '../../gateway/src/services/book-canon.ts';
import { LibraryService } from '../../gateway/src/services/library.ts';
import { CostTracker, localDayKey } from '../../gateway/src/services/costs.ts';
import { BookService } from '../../gateway/src/services/book.ts';

function write(base: string, rel: string, body: string): void {
  const p = join(base, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, body, 'utf-8');
}

// ── (a) interpolate warns once on a genuinely-absent var, stays silent on present-but-empty ──

test('interpolate substitutes a typo\'d var as empty AND warns about it', () => {
  const warnings: unknown[][] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    const out = interpolate('{{known36a}} {{typo36a}}', { known36a: 'X' });
    assert.equal(out, 'X ');
    assert.ok(warnings.some((w) => String(w[0]).includes('typo36a')), 'warned about the missing var');
  } finally {
    console.warn = orig;
  }
});

test('interpolate stays silent for a present-but-empty/null var', () => {
  const warnings: unknown[][] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    const out = interpolate('[{{empty36a}}][{{nullish36a}}]', { empty36a: '', nullish36a: null as unknown as string });
    assert.equal(out, '[][]');
    assert.equal(warnings.length, 0, 'present keys (even empty/null) never warn');
  } finally {
    console.warn = orig;
  }
});

// ── (b) provider-throttle limit 0 must not deadlock ──

test('acquireSlot with a configured limit of 0 clamps to 1 instead of deadlocking', async () => {
  const throttle = new ProviderThrottle({ grok: 0 });
  const result = await Promise.race([
    throttle.run('grok', async () => 'ok'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('deadlocked')), 500)),
  ]);
  assert.equal(result, 'ok');
});

test('a positive configured limit is unaffected by the clamp', async () => {
  const throttle = new ProviderThrottle({ grok: 1 });
  const order: string[] = [];
  const gate: { resolve?: () => void } = {};
  const gated = new Promise<void>((r) => { gate.resolve = r; });
  const p1 = throttle.run('grok', async () => { order.push('start-1'); await gated; order.push('end-1'); });
  await new Promise((r) => setImmediate(r));
  const p2 = throttle.run('grok', async () => { order.push('start-2'); });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(order, ['start-1'], 'limit of 1 still serializes (clamp does not loosen valid limits)');
  gate.resolve!();
  await Promise.all([p1, p2]);
});

// ── (c) canon file selection is deterministic across repeated calls ──

test('pickCanonFile picks the most-recently-modified match, deterministically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canon-pick-'));
  try {
    writeFileSync(join(dir, 'a-character-bible.md'), 'older');
    writeFileSync(join(dir, 'b-character-bible.md'), 'newer');
    const now = Date.now() / 1000;
    utimesSync(join(dir, 'a-character-bible.md'), now - 100, now - 100);
    utimesSync(join(dir, 'b-character-bible.md'), now, now);
    const files = ['a-character-bible.md', 'b-character-bible.md'];
    const re = /character-bible\.md$/i;
    const first = pickCanonFile(dir, files, re);
    const second = pickCanonFile(dir, files, re);
    assert.equal(first, 'b-character-bible.md', 'newer mtime wins');
    assert.equal(second, first, 'repeated calls agree — deterministic');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pickCanonFile ties on mtime break by filename ascending', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canon-pick-tie-'));
  try {
    writeFileSync(join(dir, 'z-character-bible.md'), 'z');
    writeFileSync(join(dir, 'a-character-bible.md'), 'a');
    const now = Date.now() / 1000;
    utimesSync(join(dir, 'z-character-bible.md'), now, now);
    utimesSync(join(dir, 'a-character-bible.md'), now, now); // identical mtime
    const picked = pickCanonFile(dir, ['z-character-bible.md', 'a-character-bible.md'], /character-bible\.md$/i);
    assert.equal(picked, 'a-character-bible.md', 'name-ascending tiebreak on equal mtime');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('buildBookCanonBlock uses the deterministic pick end-to-end with 2 matching files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'canon-e2e-'));
  try {
    writeFileSync(join(dir, 'step-3-character-bible.md'), 'Hero: OLDER DRAFT');
    writeFileSync(join(dir, 'step-9-character-bible.md'), 'Hero: NEWEST DRAFT');
    const now = Date.now() / 1000;
    utimesSync(join(dir, 'step-3-character-bible.md'), now - 50, now - 50);
    utimesSync(join(dir, 'step-9-character-bible.md'), now, now);
    const block1 = buildBookCanonBlock(dir, { title: 'T' });
    const block2 = buildBookCanonBlock(dir, { title: 'T' });
    assert.match(block1, /NEWEST DRAFT/);
    assert.equal(block1, block2, 'repeated builds agree');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── (d) malformed pipeline JSON is skipped + warned on library load, valid pipeline still loads ──

test('LibraryService skips a malformed pipeline JSON on load without crashing; valid pipeline loads', async () => {
  const root = mkdtempSync(join(tmpdir(), 'library-pipeline-validate-'));
  try {
    const builtin = join(root, 'library');
    write(builtin, 'pipelines/good.json', JSON.stringify({ schemaVersion: 1, name: 'good', label: 'Good', description: 'd', steps: [] }));
    write(builtin, 'pipelines/bad.json', JSON.stringify({ notAPipeline: true })); // missing steps[] + schemaVersion
    const fakeSkills = { getSkillCatalog: () => [], getSkillByName: () => undefined } as never;
    const lib = new LibraryService(builtin, join(root, 'workspace', 'library'), fakeSkills);

    const errors: unknown[][] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      await lib.loadAll(); // must not throw
    } finally {
      console.error = orig;
    }

    const names = lib.list('pipeline').map((p) => p.name);
    assert.ok(names.includes('good'), 'valid pipeline still loads');
    assert.ok(!names.includes('bad'), 'malformed pipeline is skipped, not loaded raw');
    assert.ok(errors.some((e) => String(e[0]).includes('bad') && String(e[0]).includes('⚠')), 'a warning was logged for the malformed entry');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── (e) daily reset uses local date parts, not UTC ──

test('localDayKey builds the key from local date parts (not toISOString/UTC)', () => {
  const offsetMin = new Date().getTimezoneOffset(); // >0 west of UTC, <0 east of UTC, 0 at UTC
  let momentUtc: Date;
  if (offsetMin > 0) {
    momentUtc = new Date(Date.UTC(2026, 6, 10, 0, 30)); // just after UTC midnight -> still "yesterday" west of UTC
  } else if (offsetMin < 0) {
    momentUtc = new Date(Date.UTC(2026, 6, 10, 23, 30)); // just before UTC midnight -> already "tomorrow" east of UTC
  } else {
    momentUtc = new Date(Date.UTC(2026, 6, 10, 12, 0));
  }
  const expectedLocal = `${momentUtc.getFullYear()}-${String(momentUtc.getMonth() + 1).padStart(2, '0')}-${String(momentUtc.getDate()).padStart(2, '0')}`;
  assert.equal(localDayKey(momentUtc), expectedLocal);
  if (Math.abs(offsetMin) >= 60) {
    const utcKey = momentUtc.toISOString().split('T')[0];
    assert.notEqual(localDayKey(momentUtc), utcKey, 'this moment straddles local vs UTC midnight for the runner\'s TZ');
  }
});

test('CostTracker persists lastResetDay using the local date key', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'costs-localday-'));
  const persistPath = join(dir, 'costs.json');
  try {
    const c = new CostTracker({ persistPath });
    c.record('claude', 100, 0.01);
    await c.flush();
    const state = JSON.parse(readFileSync(persistPath, 'utf-8'));
    assert.equal(state.lastResetDay, localDayKey());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── (f) a create() failure after claimSlug frees the slug for reuse ──

const fakeAuthorVoicePipeline = {
  get(kind: string, _name: string): unknown {
    if (kind === 'author') return { files: { 'SOUL.md': 'x' }, source: 'builtin', description: 'd' };
    if (kind === 'voice') return { files: { 'STYLE-GUIDE.md': 'x' }, source: 'builtin', description: 'd' };
    if (kind === 'pipeline') return { pipeline: { schemaVersion: 1, name: 'p', label: 'P', description: 'd', steps: [] }, source: 'builtin' };
    return undefined;
  },
};

test('create() failure after claimSlug removes the claimed dir so the base slug is reusable', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-createfail-'));
  try {
    const booksDir = join(root, 'workspace', 'books');

    // Poisoned genre: an empty filename resolves (via path.join) to the genre
    // DIRECTORY itself, so writeFile() throws EISDIR partway through create() —
    // a deterministic post-claim failure without touching real fs internals.
    const poisonedLib = {
      get(kind: string, name: string): unknown {
        if (kind === 'genre') return { files: { '': 'BOOM' }, source: 'builtin', description: 'd' };
        return fakeAuthorVoicePipeline.get(kind, name);
      },
    } as unknown as LibraryService;

    const svc = new BookService(booksDir, poisonedLib, '9.9.9');
    await assert.rejects(() => svc.create({ title: 'Boom Book', author: 'a', voice: 'v', genre: 'g', pipeline: 'p', sections: [] }));

    const slug = 'boom-book';
    assert.equal(existsSync(join(booksDir, slug)), false, 'the claimed (partially-created) slug dir was removed');

    // Retry with the same title, no poison this time — must reuse the base
    // slug ("boom-book"), not roll forward to "boom-book-2".
    const healthyLib = fakeAuthorVoicePipeline as unknown as LibraryService;
    const svc2 = new BookService(booksDir, healthyLib, '9.9.9');
    const created = await svc2.create({ title: 'Boom Book', author: 'a', voice: 'v', genre: null, pipeline: 'p', sections: [] });
    assert.equal(created.slug, 'boom-book', 'base slug is reusable after the earlier failure');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a book NOT involved in the failure is untouched by the cleanup', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bookclaw-createfail-sibling-'));
  try {
    const booksDir = join(root, 'workspace', 'books');
    const healthyLib = fakeAuthorVoicePipeline as unknown as LibraryService;
    const svc = new BookService(booksDir, healthyLib, '9.9.9');
    const sibling = await svc.create({ title: 'Sibling Book', author: 'a', voice: 'v', genre: null, pipeline: 'p', sections: [] });
    assert.ok(existsSync(join(booksDir, sibling.slug)));

    const poisonedLib = {
      get(kind: string, name: string): unknown {
        if (kind === 'genre') return { files: { '': 'BOOM' }, source: 'builtin', description: 'd' };
        return fakeAuthorVoicePipeline.get(kind, name);
      },
    } as unknown as LibraryService;
    const svc2 = new BookService(booksDir, poisonedLib, '9.9.9');
    await assert.rejects(() => svc2.create({ title: 'Boom Book Two', author: 'a', voice: 'v', genre: 'g', pipeline: 'p', sections: [] }));

    assert.ok(existsSync(join(booksDir, sibling.slug)), 'sibling book untouched by the failed create()\'s cleanup');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
