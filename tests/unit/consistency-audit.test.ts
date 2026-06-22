import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsistencyStore } from '../../gateway/src/services/consistency/fact-store.js';
import { runConsistencyAudit } from '../../gateway/src/services/consistency/audit.js';
import { selectChapterFiles, inferGap } from '../../gateway/src/services/consistency/audit.js';

test('audit reports a planted eye-color contradiction across two chapters', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-audit-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('sqlite unavailable — skipping'); return; }

    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'chapter-1.md'), 'John has blue eyes.');
    writeFileSync(join(dataDir, 'chapter-2.md'), 'John has green eyes.');

    // Stub extractor: chapter 1 -> blue (immutable), chapter 2 -> green (immutable).
    const extract = async (text: string, _k: any[], base: number) => ({
      scenes: [{ storyTime: base, timeLabel: null }],
      facts: [{ entity: 'John', aliases: ['John'], attribute: 'eye_color', type: 'immutable' as const,
        valueRaw: text.includes('blue') ? 'blue' : 'green', valueNorm: text.includes('blue') ? 'blue' : 'green',
        storyTime: base, timeLabel: null, transition: null, scene: 0, source: 'manuscript' as const, evidence: text }],
    });
    const books = {
      dataDirOf: () => dataDir, worldDocsOf: () => null, worldbuildingOf: () => null, open: async () => ({ manifest: { pulledFrom: {} } }),
    };
    const report = await runConsistencyAudit('b1', { store, books, extract });
    assert.equal(report.chaptersScanned, 2);
    const c = report.findings.find(f => f.category === 'contradiction' && f.attribute === 'eye_color');
    assert.ok(c, 'eye-color contradiction reported');
    assert.equal(c!.severity, 'high');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// C1 + I3: worldbuildingOf returns a markdown STRING; must be seeded as canon even with no world bound.
test('C1+I3: worldbuildingOf string content seeds canon and detects canon-divergence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-c1-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('sqlite unavailable — skipping'); return; }

    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'chapter-1.md'), 'John has green eyes.');

    // Extract stub: canon text ("John has blue eyes.") → blue immutable fact.
    //              chapter text ("John has green eyes.") → green immutable fact.
    const extract = async (text: string, _k: any[], base: number) => {
      const isBlue = text.includes('blue');
      return {
        scenes: [{ storyTime: base, timeLabel: null }],
        facts: [{
          entity: 'John', aliases: ['John'], attribute: 'eye_color',
          type: 'immutable' as const,
          valueRaw: isBlue ? 'blue eyes' : 'green eyes',
          valueNorm: isBlue ? 'blue' : 'green',
          storyTime: base, timeLabel: null, transition: null, scene: 0,
          source: 'manuscript' as const, evidence: text.slice(0, 40),
        }],
      };
    };

    const books = {
      dataDirOf: () => dataDir,
      // worldbuildingOf returns a markdown STRING (not a path) — the fix for C1.
      worldbuildingOf: () => 'John has blue eyes.',
      worldDocsOf: () => null,
      // No world bound — tests I3 (null worldName path).
      open: async () => ({ manifest: { pulledFrom: {} } }),
    };

    const report = await runConsistencyAudit('b1', { store, books, extract });
    assert.equal(report.chaptersScanned, 1);
    const div = report.findings.find(f => f.category === 'canon-divergence');
    assert.ok(div, 'canon-divergence finding expected (C1 + I3)');
    assert.equal(div!.severity, 'high');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// I1: selectChapterFiles unit tests
test('I1: selectChapterFiles keeps only chapter prose, deduplicates by stage rank', () => {
  // Typical novel-pipeline output filenames
  const names = [
    '1-develop-premise.md',
    '12-chapter-outline.md',
    '10-world-rules-consistency-guide.md',
    '14-write-chapter-1.md',
    '40-polish-chapter-1.md',
    '14-write-chapter-2.md',
    '15-write-chapter-3.md',
    '41-revise-chapter-2.md',
    'chapter-4.md',        // bare name, rank 0
    'chapter-notes.md',    // excluded: contains "notes"
    'chapter-outline-summary.md', // excluded: contains "outline" + "summary"
  ];

  const result = selectChapterFiles(names);

  // chapter-1: polish (rank 3) beats write (rank 1)
  assert.ok(result.includes('40-polish-chapter-1.md'), 'polish preferred over write for ch1');
  assert.ok(!result.includes('14-write-chapter-1.md'), 'write-chapter-1 excluded (polish wins)');
  // chapter-2: revise (rank 2) beats write (rank 1)
  assert.ok(result.includes('41-revise-chapter-2.md'), 'revise preferred over write for ch2');
  assert.ok(!result.includes('14-write-chapter-2.md'), 'write-chapter-2 excluded (revise wins)');
  // chapter-3: only write present
  assert.ok(result.includes('15-write-chapter-3.md'), 'write-chapter-3 kept');
  // chapter-4: bare name, rank 0 — should still be kept
  assert.ok(result.includes('chapter-4.md'), 'bare chapter-4.md kept');
  // Noise files excluded
  assert.ok(!result.includes('1-develop-premise.md'), 'premise excluded');
  assert.ok(!result.includes('12-chapter-outline.md'), 'outline excluded');
  assert.ok(!result.includes('10-world-rules-consistency-guide.md'), 'guide excluded');
  assert.ok(!result.includes('chapter-notes.md'), 'notes excluded');
  assert.ok(!result.includes('chapter-outline-summary.md'), 'outline-summary excluded');
  // Sorted by chapter number ascending
  const nums = result.map(n => {
    const m = n.toLowerCase().replace(/\.md$/, '').match(/chapter-(\d+)/);
    return m ? parseInt(m[1], 10) : -1;
  });
  assert.deepEqual(nums, [...nums].sort((a, b) => a - b), 'sorted ascending by chapter number');
});

// I2: inferGap ordering — longer must be tested before day
test('I2: inferGap classifies multi-day spans correctly', () => {
  assert.equal(inferGap(null, 'three days later'), 'longer', '"three days later" -> longer');
  assert.equal(inferGap(null, 'days later'), 'longer', '"days later" -> longer');
  assert.equal(inferGap(null, 'two weeks later'), 'longer', '"two weeks later" -> longer');
  assert.equal(inferGap(null, 'months later'), 'longer', '"months later" -> longer');
  assert.equal(inferGap(null, 'next morning'), 'day', '"next morning" -> day');
  assert.equal(inferGap(null, 'later that day'), 'day', '"later that day" -> day');
  assert.equal(inferGap(null, 'that night'), 'day', '"that night" -> day');
  assert.equal(inferGap(null, 'that evening'), 'same', '"that evening" -> same');
  assert.equal(inferGap(null, 'moments later'), 'same', '"moments later" -> same');
  assert.equal(inferGap(null, 'meanwhile'), 'same', '"meanwhile" -> same');
  assert.equal(inferGap(null, null), 'unknown', 'null -> unknown');
});
