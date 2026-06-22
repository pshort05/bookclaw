/**
 * Unit tests for World Repository Phase 5: appendix render.
 *   - stripAppendixCodes: removes in-world classification header lines, keeps attribution + prose
 *   - resolveBookAppendix: ordered entries, title override, fail-soft skip, strip toggle
 *   - generateDocxBuffer with appendix: returns non-empty Buffer, no throw
 *   - generateEpubBuffer with appendix: XHTML + manifest + spine entries in the zip
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';

import { stripAppendixCodes, resolveBookAppendix } from '../../gateway/src/services/world-appendix.js';
import { generateDocxBuffer } from '../../gateway/src/services/docx-export.js';
import { generateEpubBuffer } from '../../gateway/src/services/epub-export.js';
import { serializeWorldDoc } from '../../gateway/src/services/world-parse.js';
import type { BookService } from '../../gateway/src/services/book.js';
import type { WorldService } from '../../gateway/src/services/world.js';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const PROSE_1 = 'The mountains stretch from the eastern coast to the central plains.';
const PROSE_2 = 'Scholars have debated the classification of the Thornwood for centuries.';
const PROSE_3 = 'Access is granted to all citizens of the Luminarch.';
const ATTRIBUTION = 'Compiled by Talen Windwalker; transcribed by Morvin Ironhand';

/** A body that contains all four code-line patterns plus attribution and prose. */
const BODY_WITH_CODES = [
  `Classification: FG-GEO-0141`,
  `Distribution: Approved for General Access`,
  `Access Level: Restricted`,
  `Clearance: Cloister-Only`,
  ATTRIBUTION,
  '',
  PROSE_1,
  PROSE_2,
  PROSE_3,
].join('\n');

// ─────────────────────────────────────────────────────────────
// Task 1: stripAppendixCodes
// ─────────────────────────────────────────────────────────────

describe('stripAppendixCodes', () => {
  it('removes all four code-line patterns', () => {
    const result = stripAppendixCodes(BODY_WITH_CODES);
    assert.ok(!result.includes('Classification: FG-GEO-0141'), 'Classification line should be removed');
    assert.ok(!result.includes('Distribution: Approved'), 'Distribution line should be removed');
    assert.ok(!result.includes('Access Level: Restricted'), 'Access Level line should be removed');
    assert.ok(!result.includes('Clearance: Cloister-Only'), 'Clearance line should be removed');
  });

  it('keeps the attribution line', () => {
    const result = stripAppendixCodes(BODY_WITH_CODES);
    assert.ok(result.includes(ATTRIBUTION), 'Attribution line must be kept');
  });

  it('keeps all prose paragraphs', () => {
    const result = stripAppendixCodes(BODY_WITH_CODES);
    assert.ok(result.includes(PROSE_1), 'Prose 1 must remain');
    assert.ok(result.includes(PROSE_2), 'Prose 2 must remain (even though it mentions "classification" mid-sentence)');
    assert.ok(result.includes(PROSE_3), 'Prose 3 must remain (even though it contains "Access")');
  });

  it('strips lines with leading markup: ### Classification and > Distribution', () => {
    const body = [
      '### Classification: FG-GEO-0199',
      '> Distribution: Internal Only',
      'Normal prose here.',
    ].join('\n');
    const result = stripAppendixCodes(body);
    assert.ok(!result.includes('Classification: FG-GEO-0199'), '### Classification should be stripped');
    assert.ok(!result.includes('Distribution: Internal Only'), '> Distribution should be stripped');
    assert.ok(result.includes('Normal prose here.'), 'Prose survives');
  });

  it('is a no-op when no code lines exist', () => {
    const clean = [ATTRIBUTION, '', PROSE_1, PROSE_2].join('\n');
    assert.equal(stripAppendixCodes(clean), clean);
  });
});

// ─────────────────────────────────────────────────────────────
// Task 2: resolveBookAppendix
// ─────────────────────────────────────────────────────────────

/** Build a minimal WorldDocument-shaped object. */
function makeDoc(docId: string, title: string) {
  return {
    docId,
    meta: {
      title,
      attribution: `Compiled by ${docId}-author`,
      type: 'field-guide',
      classification: 'FG-GEO-0001',
      clearance: 'General Access',
      domain: 'GEO',
      tags: [],
      summary: '',
      appendixEligible: true,
    },
    body: [
      `Classification: ${docId.toUpperCase()}-CODE`,
      `Compiled by ${docId}-author`,
      `Prose about ${docId}.`,
    ].join('\n'),
  };
}

function makeFakeBooks(opts: {
  appendix: Array<{ docId: string; title?: string; order: number }>;
  worldName?: string;
}): unknown {
  return {
    open: async (_slug: string) => ({
      manifest: {
        id: 'test-book',
        slug: 'test-book',
        title: 'Test Book',
        schemaVersion: 2,
        createdByApp: '0.0.0',
        lastWrittenByApp: '0.0.0',
        phase: 'planning',
        createdAt: new Date().toISOString(),
        pulledFrom: {
          author: { name: 'author-a', source: 'builtin' },
          pipeline: { name: 'pipeline-a', source: 'builtin' },
          sections: [],
          world: opts.worldName ? { name: opts.worldName, source: 'workspace' } : null,
        },
        appendix: opts.appendix,
        worldDocs: [],
        history: [],
      },
      status: 'ok' as const,
    }),
    templatesDir: (_slug: string) => '/nonexistent/path/that/does/not/exist',
  };
}

function makeFakeWorlds(stripCodes: boolean): unknown {
  return {
    getConfig: (_name: string) => ({ stripCodesInAppendix: stripCodes }),
    getDocument: (_name: string, docId: string) => {
      if (docId === 'doc-a') return makeDoc('doc-a', 'Doc Alpha');
      if (docId === 'doc-b') return makeDoc('doc-b', 'Doc Beta');
      return undefined;
    },
  };
}

describe('resolveBookAppendix', () => {
  it('returns [] when appendix is empty', async () => {
    const books = makeFakeBooks({ appendix: [], worldName: 'demo' }) as unknown as BookService;
    const worlds = makeFakeWorlds(true) as unknown as WorldService;
    const result = await resolveBookAppendix(books, worlds, 'test-book');
    assert.deepEqual(result, []);
  });

  it('orders entries by order field ascending and applies title override', async () => {
    const books = makeFakeBooks({
      appendix: [
        { docId: 'doc-b', order: 2 },
        { docId: 'doc-a', order: 1, title: 'Custom Title' },
      ],
      worldName: 'demo',
    }) as unknown as BookService;
    const worlds = makeFakeWorlds(true) as unknown as WorldService;
    const result = await resolveBookAppendix(books, worlds, 'test-book');
    assert.equal(result.length, 2);
    assert.equal(result[0].title, 'Custom Title', 'manifest title override must apply to doc-a');
    assert.equal(result[1].title, 'Doc Beta', 'doc-b uses meta.title');
  });

  it('strips classification lines from body when stripCodesInAppendix is true', async () => {
    const books = makeFakeBooks({
      appendix: [{ docId: 'doc-a', order: 1 }],
      worldName: 'demo',
    }) as unknown as BookService;
    const worlds = makeFakeWorlds(true) as unknown as WorldService;
    const result = await resolveBookAppendix(books, worlds, 'test-book');
    assert.equal(result.length, 1);
    assert.ok(!result[0].body.includes('DOC-A-CODE'), 'Classification line must be stripped');
    assert.ok(result[0].body.includes('Prose about doc-a'), 'Prose must remain');
  });

  it('retains classification lines when stripCodesInAppendix is false', async () => {
    const books = makeFakeBooks({
      appendix: [{ docId: 'doc-a', order: 1 }],
      worldName: 'demo',
    }) as unknown as BookService;
    const worlds = makeFakeWorlds(false) as unknown as WorldService;
    const result = await resolveBookAppendix(books, worlds, 'test-book');
    assert.equal(result.length, 1);
    assert.ok(result[0].body.includes('DOC-A-CODE'), 'Classification line must be kept when strip disabled');
  });

  it('carries attribution from meta', async () => {
    const books = makeFakeBooks({
      appendix: [{ docId: 'doc-a', order: 1 }],
      worldName: 'demo',
    }) as unknown as BookService;
    const worlds = makeFakeWorlds(true) as unknown as WorldService;
    const result = await resolveBookAppendix(books, worlds, 'test-book');
    assert.equal(result[0].attribution, 'Compiled by doc-a-author');
  });

  it('skips unknown docId without throwing (fail-soft)', async () => {
    const books = makeFakeBooks({
      appendix: [
        { docId: 'doc-a', order: 1 },
        { docId: 'no-such-doc', order: 2 },
      ],
      worldName: 'demo',
    }) as unknown as BookService;
    const worlds = makeFakeWorlds(true) as unknown as WorldService;
    const result = await resolveBookAppendix(books, worlds, 'test-book');
    assert.equal(result.length, 1, 'Unknown docId is skipped, not thrown');
    assert.equal(result[0].title, 'Doc Alpha');
  });

  it('returns [] when no world is bound', async () => {
    const books = makeFakeBooks({
      appendix: [{ docId: 'doc-a', order: 1 }],
      worldName: undefined,
    }) as unknown as BookService;
    const worlds = makeFakeWorlds(true) as unknown as WorldService;
    const result = await resolveBookAppendix(books, worlds, 'test-book');
    assert.deepEqual(result, []);
  });

  it('resolves entry from snapshot (not live world) when snapshot file exists', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'bookclaw-test-'));
    try {
      const worldDir = join(tmpDir, 'world');
      await mkdir(worldDir, { recursive: true });

      // Write a snapshot for doc-snap with a body distinct from what the live world would return
      const snapshotMeta = {
        title: 'Snapshot Title',
        type: 'field-guide',
        classification: 'FG-GEO-0001',
        clearance: 'General Access',
        domain: 'GEO',
        attribution: 'Compiled by snapshot-author',
        tags: [] as string[],
        summary: 'Snapshot summary',
      };
      const snapshotBody = 'This body comes from the snapshot file.';
      const snapshotRaw = serializeWorldDoc(snapshotMeta, snapshotBody);
      await writeFile(join(worldDir, 'doc-snap.md'), snapshotRaw, 'utf-8');

      // Fake books pointing templatesDir at our temp dir
      const books: unknown = {
        open: async (_slug: string) => ({
          manifest: {
            id: 'test-book', slug: 'test-book', title: 'Test Book',
            schemaVersion: 2, createdByApp: '0.0.0', lastWrittenByApp: '0.0.0',
            phase: 'planning', createdAt: new Date().toISOString(),
            pulledFrom: {
              author: { name: 'author-a', source: 'builtin' },
              pipeline: { name: 'pipeline-a', source: 'builtin' },
              sections: [],
              world: { name: 'demo', source: 'workspace' },
            },
            appendix: [{ docId: 'doc-snap', order: 1 }],
            worldDocs: [],
            history: [],
          },
          status: 'ok' as const,
        }),
        templatesDir: (_slug: string) => tmpDir,
      };

      // Live world returns something different for doc-snap so we can detect which source won
      const worlds: unknown = {
        getConfig: (_name: string) => ({ stripCodesInAppendix: false }),
        getDocument: (_name: string, docId: string) => {
          if (docId === 'doc-snap') {
            return {
              docId: 'doc-snap',
              meta: { ...snapshotMeta, title: 'Live World Title' },
              body: 'This body comes from the LIVE world.',
            };
          }
          return undefined;
        },
      };

      const result = await resolveBookAppendix(books as BookService, worlds as WorldService, 'test-book');
      assert.equal(result.length, 1, 'one entry resolved');
      assert.equal(result[0].title, 'Snapshot Title', 'title must come from the snapshot, not live world');
      assert.ok(result[0].body.includes('snapshot file'), 'body must come from the snapshot, not live world');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('skips entries whose doc has appendixEligible: false (both snapshot and live branches)', async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), 'bookclaw-test-'));
    try {
      const worldDir = join(tmpDir, 'world');
      await mkdir(worldDir, { recursive: true });

      // Write an ineligible snapshot
      const ineligibleMeta = {
        title: 'Internal Doc',
        type: 'field-guide',
        classification: 'FG-GEO-0099',
        clearance: 'Restricted',
        domain: 'INT',
        tags: [] as string[],
        summary: 'Internal only',
        appendixEligible: false,
      };
      await writeFile(
        join(worldDir, 'doc-ineligible-snap.md'),
        serializeWorldDoc(ineligibleMeta, 'Secret content.'),
        'utf-8',
      );

      const books: unknown = {
        open: async (_slug: string) => ({
          manifest: {
            id: 'test-book', slug: 'test-book', title: 'Test Book',
            schemaVersion: 2, createdByApp: '0.0.0', lastWrittenByApp: '0.0.0',
            phase: 'planning', createdAt: new Date().toISOString(),
            pulledFrom: {
              author: { name: 'author-a', source: 'builtin' },
              pipeline: { name: 'pipeline-a', source: 'builtin' },
              sections: [],
              world: { name: 'demo', source: 'workspace' },
            },
            appendix: [
              { docId: 'doc-ineligible-snap', order: 1 },  // ineligible via snapshot
              { docId: 'doc-ineligible-live', order: 2 },  // ineligible via live world
              { docId: 'doc-eligible', order: 3 },          // eligible via live world
            ],
            worldDocs: [],
            history: [],
          },
          status: 'ok' as const,
        }),
        templatesDir: (_slug: string) => tmpDir,
      };

      const worlds: unknown = {
        getConfig: (_name: string) => ({ stripCodesInAppendix: false }),
        getDocument: (_name: string, docId: string) => {
          if (docId === 'doc-ineligible-live') {
            return {
              docId: 'doc-ineligible-live',
              meta: {
                title: 'Ineligible Live', type: 'field-guide', classification: 'FG-GEO-0002',
                clearance: 'General Access', domain: 'GEO', tags: [], summary: 'x',
                appendixEligible: false,
              },
              body: 'Should not appear.',
            };
          }
          if (docId === 'doc-eligible') {
            return {
              docId: 'doc-eligible',
              meta: {
                title: 'Eligible Doc', type: 'field-guide', classification: 'FG-GEO-0003',
                clearance: 'General Access', domain: 'GEO', tags: [], summary: 'x',
                appendixEligible: true,
              },
              body: 'Eligible content.',
            };
          }
          return undefined;
        },
      };

      const result = await resolveBookAppendix(books as BookService, worlds as WorldService, 'test-book');
      assert.equal(result.length, 1, 'only the eligible doc must be included');
      assert.equal(result[0].title, 'Eligible Doc', 'the eligible entry must be present');
      assert.ok(!result.some((e) => e.body.includes('Secret content')), 'ineligible snapshot must be skipped');
      assert.ok(!result.some((e) => e.body.includes('Should not appear')), 'ineligible live doc must be skipped');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Task 4: generateDocxBuffer with appendix
// ─────────────────────────────────────────────────────────────

describe('generateDocxBuffer appendix', () => {
  it('returns a non-empty Buffer without throwing', async () => {
    const result = await generateDocxBuffer({
      title: 'Test Book',
      author: 'Test Author',
      content: '# Chapter 1\n\nSome content here.',
      appendix: [
        { title: 'Field Guide', attribution: 'Compiled by Talen', body: 'Narrative prose here.' },
      ],
    });
    assert.ok(Buffer.isBuffer(result), 'Result must be a Buffer');
    assert.ok(result.length > 0, 'Buffer must not be empty');
  });

  it('returns a non-empty Buffer even with empty appendix', async () => {
    const result = await generateDocxBuffer({
      title: 'Test Book',
      author: 'Test Author',
      content: '# Chapter 1\n\nSome content here.',
      appendix: [],
    });
    assert.ok(Buffer.isBuffer(result));
    assert.ok(result.length > 0);
  });
});

// ─────────────────────────────────────────────────────────────
// Task 5: generateEpubBuffer with appendix
// ─────────────────────────────────────────────────────────────

describe('generateEpubBuffer appendix', () => {
  it('includes appendix1.xhtml in the zip with title heading, attribution, and prose', async () => {
    const result = await generateEpubBuffer({
      title: 'Test Book',
      author: 'Test Author',
      content: '# Chapter 1\n\nBody.',
      appendix: [
        { title: 'Field Guide', attribution: 'Compiled by Talen', body: 'Narrative prose.' },
      ],
    });
    const z = new AdmZip(result);
    const entry = z.getEntry('OEBPS/appendix1.xhtml');
    assert.ok(entry !== null && entry !== undefined, 'OEBPS/appendix1.xhtml must exist in the EPUB zip');
    const text = entry!.getData().toString('utf-8');
    assert.ok(text.includes('<h1>Field Guide</h1>'), 'appendix heading must be present');
    assert.ok(text.includes('Compiled by Talen'), 'attribution must be present');
    assert.ok(text.includes('Narrative prose.'), 'body prose must be present');
  });

  it('adds appendix manifest item and spine itemref to content.opf', async () => {
    const result = await generateEpubBuffer({
      title: 'Test Book',
      author: 'Test Author',
      content: '# Chapter 1\n\nBody.',
      appendix: [
        { title: 'Field Guide', attribution: 'Compiled by Talen', body: 'Narrative prose.' },
      ],
    });
    const z = new AdmZip(result);
    const opf = z.getEntry('OEBPS/content.opf');
    assert.ok(opf !== null && opf !== undefined, 'content.opf must exist');
    const opfText = opf!.getData().toString('utf-8');
    assert.ok(opfText.includes('id="appendix1"'), 'manifest must contain appendix1 item');
    assert.ok(opfText.includes('idref="appendix1"'), 'spine must contain appendix1 itemref');
  });

  it('works without appendix (no regression)', async () => {
    const result = await generateEpubBuffer({
      title: 'Test Book',
      author: 'Test Author',
      content: '# Chapter 1\n\nBody.',
    });
    assert.ok(Buffer.isBuffer(result));
    assert.ok(result.length > 0);
  });
});
