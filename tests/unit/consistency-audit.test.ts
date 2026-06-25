import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConsistencyStore } from '../../gateway/src/services/consistency/fact-store.js';
import { runConsistencyAudit } from '../../gateway/src/services/consistency/audit.js';
import { selectChapterFiles, inferGap, loadNonCanonicalOverride, splitManuscriptIntoChapters, findCombinedManuscript, accumulateElapsed } from '../../gateway/src/services/consistency/audit.js';

test('accumulateElapsed: longer jumps add 30, same/unknown add 0, day adds 1', () => {
  const r = accumulateElapsed(0, null, ['that evening', 'next morning', 'two years later', null]);
  // same(+0)=0 ; day(+1)=1 ; longer(+30)=31 ; unknown(+0)=31
  assert.deepEqual(r.sceneElapsed, [0, 1, 31, 31]);
  assert.equal(r.elapsed, 31);
  assert.equal(r.lastLabel, null);
});

test('accumulateElapsed: carries the running clock + prev label across calls (chapters)', () => {
  const a = accumulateElapsed(0, null, ['morning']);                      // day -> 1
  const b = accumulateElapsed(a.elapsed, a.lastLabel, ['months later']);  // longer -> 31
  assert.equal(b.elapsed, 31);
  assert.equal(b.sceneElapsed[0], 31);
});

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

test('Selective Exclusion: a dream scene impossibility is NOT flagged', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-excl-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) return;
    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'chapter-1.md'), 'John has blue eyes.');
    writeFileSync(join(dataDir, 'chapter-2.md'), 'In the dream John had red eyes.');

    // ch1: canonical blue immutable. ch2: dream scene (canonical:false) asserts red.
    const extract = async (text: string, _k: any[], base: number) => {
      const isDream = text.includes('dream');
      return {
        scenes: [{ storyTime: base, timeLabel: isDream ? 'in the dream' : null, canonical: !isDream }],
        knowledge: [],
        facts: [{ entity: 'John', aliases: ['John'], attribute: 'eye_color', type: 'immutable' as const,
          valueRaw: isDream ? 'red' : 'blue', valueNorm: isDream ? 'red' : 'blue',
          storyTime: base, timeLabel: null, transition: null, scene: 0, source: 'manuscript' as const,
          evidence: text, canonical: !isDream }],
      };
    };
    const books = { dataDirOf: () => dataDir, worldDocsOf: () => null, worldbuildingOf: () => null, open: async () => ({ manifest: { pulledFrom: {} } }) };
    const report = await runConsistencyAudit('b1', { store, books, extract });
    assert.equal(report.findings.find(f => f.attribute === 'eye_color'), undefined, 'dream eye-color must NOT contradict');
    assert.equal(report.nonCanonicalSceneCount, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Knowledge Matrix: use-before-acquire reported via audit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-know-audit-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) return;
    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'chapter-1.md'), 'Elena names the killer.');
    writeFileSync(join(dataDir, 'chapter-2.md'), 'Elena is told the killer.');

    const extract = async (text: string, _k: any[], base: number) => {
      const isUse = text.includes('names');
      return {
        scenes: [{ storyTime: base, timeLabel: null, canonical: true }],
        facts: [],
        knowledge: [{
          knower: 'Elena', factKey: 'Marsh killer guilty',
          kind: isUse ? 'use' as const : 'acquire' as const,
          source: isUse ? 'reference' as const : 'told' as const,
          storyTime: base, scene: 0, canonical: true, evidence: text,
        }],
      };
    };
    const books = { dataDirOf: () => dataDir, worldDocsOf: () => null, worldbuildingOf: () => null, open: async () => ({ manifest: { pulledFrom: {} } }) };
    const report = await runConsistencyAudit('b1', { store, books, extract });
    const kv = report.findings.find(f => f.category === 'knowledge-violation');
    assert.ok(kv, 'knowledge-violation expected (use in ch1 precedes acquire in ch2)');
    assert.equal(report.knowledgeEventCount, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('loadNonCanonicalOverride reads sidecar; fail-soft on missing', () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-ov-'));
  try {
    const dataDir = join(root, 'data');
    mkdirSync(dataDir, { recursive: true });
    assert.deepEqual(loadNonCanonicalOverride(dataDir), {});
    writeFileSync(join(dataDir, '.non-canonical.json'), JSON.stringify({ 'chapter-2': false }));
    assert.deepEqual(loadNonCanonicalOverride(dataDir), { 'chapter-2': false });
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

// Imported single-file manuscript support: split manuscript.md by # headings.
test('findCombinedManuscript prefers manuscript.md, ignores chapter/noise files', () => {
  assert.equal(findCombinedManuscript(['manuscript.md', 'notes.md']), 'manuscript.md');
  assert.equal(findCombinedManuscript(['love-between-departures-manuscript.md', 'cover.png']), 'love-between-departures-manuscript.md');
  assert.equal(findCombinedManuscript(['chapter-1.md', 'outline.md']), null);
  assert.equal(findCombinedManuscript([]), null);
});

test('splitManuscriptIntoChapters drops front matter + TOC and splits on top-level headings', () => {
  const ms = [
    'H.K. Author',                         // front matter — dropped (before first #)
    'Copyright 2025',
    '',
    '# Contents {#contents .TOC-Heading}', // TOC — skipped as noise
    '- a',
    '',
    '# Chapter 1 *Ferry Girl*',
    'Opening prose here.',
    '',
    '# Winter Interlude I *Dormancy*',
    'Interlude prose.',
    '## Ryan: Ice',                        // H2 subsection stays inside the interlude segment
    'More interlude.',
    '',
    '# Chapter 2 *Ferry Logic*',
    'Second chapter prose.',
  ].join('\n');
  const segs = splitManuscriptIntoChapters(ms);
  assert.deepEqual(segs.map(s => s.name), ['chapter-1-ferry-girl', 'winter-interlude-i-dormancy', 'chapter-2-ferry-logic']);
  assert.ok(segs[0].text.includes('Opening prose here.'));
  assert.ok(!segs[0].text.includes('Contents'), 'TOC excluded');
  assert.ok(!segs[0].text.includes('Copyright'), 'front matter excluded');
  assert.ok(segs[1].text.includes('## Ryan: Ice'), 'H2 subsection kept within the interlude segment');
});

test('splitManuscriptIntoChapters also treats a bare "Chapter N" line as a boundary', () => {
  const ms = [
    '# Chapter 7 *Dinner*', 'Seven prose.',
    'Chapter 8\\',            // plain-text chapter heading (trailing markdown line-break)
    'Eight prose.',
    '# Chapter 9 *Summer*', 'Nine prose.',
  ].join('\n');
  const segs = splitManuscriptIntoChapters(ms);
  assert.deepEqual(segs.map(s => s.name), ['chapter-7-dinner', 'chapter-8', 'chapter-9-summer']);
  assert.ok(segs[1].text.includes('Eight prose.'));
  assert.ok(!segs[0].text.includes('Eight prose.'), 'ch8 prose is its own segment, not merged into ch7');
});

test('splitManuscriptIntoChapters does NOT split on a prose line that merely starts with "Chapter N"', () => {
  const ms = ['# Chapter 1 *A*', 'Chapter 8 was the hardest stretch she had ever flown.', 'More.'].join('\n');
  const segs = splitManuscriptIntoChapters(ms);
  assert.equal(segs.length, 1, 'a prose sentence starting "Chapter N ..." is not a boundary');
  assert.ok(segs[0].text.includes('hardest stretch'));
});

test('imported book (single manuscript.md, no chapter files) is scanned by splitting on headings', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-import-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('sqlite unavailable — skipping'); return; }

    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    // The whole book in ONE file (the imported layout) — no chapter-<N> files.
    writeFileSync(join(dataDir, 'manuscript.md'), [
      'Title Page', 'Copyright 2025', '',
      '# Contents', '- ch1', '',
      '# Chapter 1 *Opening*', 'John has blue eyes.', '',
      '# Chapter 2 *Return*', 'John has green eyes.',
    ].join('\n'));

    const extract = async (text: string, _k: any[], base: number) => ({
      scenes: [{ storyTime: base, timeLabel: null }],
      facts: text.includes('eyes') ? [{ entity: 'John', aliases: ['John'], attribute: 'eye_color', type: 'immutable' as const,
        valueRaw: text.includes('blue') ? 'blue' : 'green', valueNorm: text.includes('blue') ? 'blue' : 'green',
        storyTime: base, timeLabel: null, transition: null, scene: 0, source: 'manuscript' as const, evidence: text }] : [],
    });
    const books = { dataDirOf: () => dataDir, worldDocsOf: () => null, worldbuildingOf: () => null, open: async () => ({ manifest: { pulledFrom: {} } }) };

    const report = await runConsistencyAudit('imported', { store, books, extract });
    assert.equal(report.chaptersScanned, 2, 'split manuscript.md into 2 chapter segments (Contents/front-matter excluded)');
    const c = report.findings.find(f => f.category === 'contradiction' && f.attribute === 'eye_color');
    assert.ok(c, 'eye-color contradiction found across the two split chapters');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('audit report includes the reverse index + orphan canon facts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'consist-rev-orph-'));
  try {
    const store = new ConsistencyStore(join(root, 'workspace'), join(root, 'db'));
    await store.initialize();
    if (!store.isAvailable()) { console.log('sqlite unavailable — skipping'); return; }
    const dataDir = join(root, 'book', 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'chapter-1.md'), 'John has blue eyes.');
    writeFileSync(join(dataDir, 'chapter-2.md'), 'John has green eyes.');

    // Canon (via worldbuildingOf) declares John's eye_color (dramatized) AND a Sword's
    // material (never dramatized → orphan). Chapters only mention John's eyes.
    const extract = async (text: string, _k: any[], base: number) => {
      const facts: any[] = [];
      if (/eyes/.test(text)) facts.push({ entity: 'John', aliases: ['John'], attribute: 'eye_color', type: 'immutable',
        valueRaw: text.includes('blue') ? 'blue' : 'green', valueNorm: text.includes('blue') ? 'blue' : 'green',
        storyTime: base, timeLabel: null, transition: null, scene: 0, source: 'manuscript', evidence: text });
      if (/Sword/.test(text)) facts.push({ entity: 'Sword', aliases: ['Sword'], attribute: 'material', type: 'immutable',
        valueRaw: 'steel', valueNorm: 'steel', storyTime: base, timeLabel: null, transition: null, scene: 0, source: 'manuscript', evidence: text });
      return { scenes: [{ storyTime: base, timeLabel: null }], facts };
    };
    const books = { dataDirOf: () => dataDir, worldbuildingOf: () => 'John has blue eyes. The Sword is steel.', worldDocsOf: () => null, open: async () => ({ manifest: { pulledFrom: {} } }) };

    const report: any = await runConsistencyAudit('b1', { store, books, extract });
    const rev = report.reverseIndex.find((r: any) => r.entity === 'John' && r.attribute === 'eye_color');
    assert.ok(rev, 'reverse index has John/eye_color');
    assert.deepEqual(rev.chapters, ['chapter-1', 'chapter-2'], 'lists the chapters that dramatize it');
    assert.equal(rev.isCanon, true, 'flagged canon-backed (editable bible fact)');
    assert.ok(report.orphanFacts.some((o: any) => o.entity === 'Sword' && o.attribute === 'material'), 'Sword material is an orphan canon fact');
    assert.ok(!report.orphanFacts.some((o: any) => o.attribute === 'eye_color'), 'John eye_color dramatized → not orphan');
  } finally { rmSync(root, { recursive: true, force: true }); }
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
