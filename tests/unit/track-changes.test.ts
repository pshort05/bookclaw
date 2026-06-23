/**
 * Characterization tests for TrackChangesService (gateway/src/services/track-changes.ts).
 *
 * Builds small in-memory .docx fixtures with the same `adm-zip` lib the service
 * uses (a zip whose only meaningful entry is word/document.xml), then asserts
 * the actual parse + accept/reject-by-index behavior.
 *
 * COVERED:
 *   - parseDocx(): insert + delete counts, generated IDs, author/date/text
 *     extraction, paragraphIndex, byType tallies, authors set, paragraphCount.
 *   - The empty-edit case: an empty <w:ins>/<w:del> is SKIPPED by parseDocx, and
 *     applyDecisions does NOT advance its change index past the skipped edit.
 *   - applyDecisions() accept/reject/pending merge for both insert and delete.
 *   - The missing-document.xml error path.
 *
 * NOT COVERED (no fixture built for these):
 *   - <w:rPrChange/> formatting changes and word/comments.xml comments — the
 *     prompt asked for one insert + one delete + one empty edit; formatting and
 *     comments live in separate code paths and are left to a future fixture.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { TrackChangesService, type ChangeStatus } from '../../gateway/src/services/track-changes.js';

/** Wrap paragraph XML fragments into a minimal valid word/document.xml docx. */
function buildDocx(paragraphsXml: string[]): Buffer {
  const body = paragraphsXml.join('\n');
  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}</w:body>` +
    '</w:document>';
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf-8'));
  return zip.toBuffer();
}

// A run of normal (untracked) text.
const run = (t: string) => `<w:r><w:t>${t}</w:t></w:r>`;
// A tracked insertion.
const ins = (author: string, date: string, t: string) =>
  `<w:ins w:id="1" w:author="${author}" w:date="${date}"><w:r><w:t>${t}</w:t></w:r></w:ins>`;
// A tracked deletion (delText carries the removed text).
const del = (author: string, date: string, t: string) =>
  `<w:del w:id="2" w:author="${author}" w:date="${date}"><w:r><w:delText>${t}</w:delText></w:r></w:del>`;

describe('TrackChangesService.parseDocx', () => {
  test('throws when word/document.xml is absent', () => {
    const empty = new AdmZip().toBuffer();
    const svc = new TrackChangesService();
    assert.throws(() => svc.parseDocx(empty), /word\/document\.xml not found/);
  });

  test('parses one insert and one delete with correct counts, types, IDs and metadata', () => {
    const para =
      `<w:p>${run('The quick ')}` +
      ins('Alice', '2026-06-01T10:00:00Z', 'brown ') +
      del('Bob', '2026-06-02T11:00:00Z', 'lazy ') +
      `${run('fox')}</w:p>`;
    const buf = buildDocx([para]);

    const report = new TrackChangesService().parseDocx(buf);

    assert.equal(report.paragraphCount, 1);
    assert.equal(report.totalChanges, 2);
    assert.deepEqual(report.byType, { insert: 1, delete: 1, formatting: 0, comment: 0 });

    const insChange = report.changes.find(c => c.type === 'insert')!;
    const delChange = report.changes.find(c => c.type === 'delete')!;

    // IDs are `ins-<paraIdx>-<changes.length-at-push-time>`. Insert is pushed
    // first (length 0), delete second (length 1).
    assert.equal(insChange.id, 'ins-0-0');
    assert.equal(delChange.id, 'del-0-1');

    assert.equal(insChange.author, 'Alice');
    assert.equal(insChange.date, '2026-06-01T10:00:00Z');
    assert.equal(insChange.text, 'brown'); // extractRunsText trims
    assert.equal(insChange.paragraphIndex, 0);
    assert.equal(insChange.status, 'pending');

    assert.equal(delChange.author, 'Bob');
    assert.equal(delChange.text, 'lazy'); // extractDelText trims
    assert.equal(delChange.paragraphIndex, 0);

    assert.deepEqual(report.authors.sort(), ['Alice', 'Bob']);
  });

  test('missing author/date attributes fall back to "Unknown" / empty string', () => {
    const para = `<w:p><w:ins w:id="9"><w:r><w:t>hi</w:t></w:r></w:ins></w:p>`;
    const report = new TrackChangesService().parseDocx(buildDocx([para]));
    assert.equal(report.totalChanges, 1);
    assert.equal(report.changes[0].author, 'Unknown');
    assert.equal(report.changes[0].date, '');
  });

  // The empty-edit case the prompt called out: an <w:ins>/<w:del> whose text is
  // empty (or whitespace-only after trim) is dropped by parseDocx via the
  // `if (!insertedText) continue;` / `if (!deletedText) continue;` guards.
  test('an empty insert and empty delete are SKIPPED (not counted, no change emitted)', () => {
    const para =
      `<w:p>${run('keep ')}` +
      `<w:ins w:id="3" w:author="A" w:date="d"><w:r><w:t></w:t></w:r></w:ins>` +
      `<w:del w:id="4" w:author="A" w:date="d"><w:r><w:delText>   </w:delText></w:r></w:del>` +
      `${run('text')}</w:p>`;
    const report = new TrackChangesService().parseDocx(buildDocx([para]));
    assert.equal(report.totalChanges, 0);
    assert.deepEqual(report.byType, { insert: 0, delete: 0, formatting: 0, comment: 0 });
    assert.deepEqual(report.authors, []);
  });

  test('paragraphIndex tracks per-paragraph position across multiple paragraphs', () => {
    const p0 = `<w:p>${run('plain')}</w:p>`;
    const p1 = `<w:p>${ins('Z', 'd', 'added')}</w:p>`;
    const report = new TrackChangesService().parseDocx(buildDocx([p0, p1]));
    assert.equal(report.paragraphCount, 2);
    assert.equal(report.totalChanges, 1);
    assert.equal(report.changes[0].paragraphIndex, 1);
    assert.equal(report.changes[0].id, 'ins-1-0');
  });
});

describe('TrackChangesService.applyDecisions — accept/reject merge by index', () => {
  // Fixture: "The quick [+brown ][-lazy ]fox" — one insert, one delete.
  function fixture(): Buffer {
    const para =
      `<w:p>${run('The quick ')}` +
      ins('Alice', 'd', 'brown ') +
      del('Bob', 'd', 'lazy ') +
      `${run('fox')}</w:p>`;
    return buildDocx([para]);
  }

  test('accepting the insert and accepting the delete: inserted text kept, deleted text gone', () => {
    const buf = fixture();
    const decisions = new Map<string, ChangeStatus>([
      ['ins-0-0', 'accepted'],
      ['del-0-1', 'accepted'],
    ]);
    const out = new TrackChangesService().applyDecisions(buf, decisions);
    // "The quick " + "brown " (accepted ins) + "" (accepted del) + "fox"
    assert.equal(out, 'The quick brown fox');
  });

  // NOTE: possible bug — when a deletion is rejected/pending (i.e. the removed
  // text should be RESTORED), applyDecisions unwraps <w:delText>x</w:delText>
  // into a bare <w:r>x</w:r>, but the final extractParagraphText →
  // extractRunsText only matches text inside <w:t>…</w:t>. The unwrapped delText
  // has no <w:t> wrapper, so the "restored" text is silently dropped. Expected
  // "The quick lazy fox"; the service actually yields "The quick fox". This test
  // pins the ACTUAL (buggy) behavior — do not treat it as the desired contract.
  test('rejecting both: insert dropped; restored delete text is LOST (delText not re-wrapped in <w:t>)', () => {
    const buf = fixture();
    const decisions = new Map<string, ChangeStatus>([
      ['ins-0-0', 'rejected'],
      ['del-0-1', 'rejected'],
    ]);
    const out = new TrackChangesService().applyDecisions(buf, decisions);
    assert.equal(out, 'The quick fox'); // see NOTE: "lazy" should have survived
  });

  // Same root cause as above: pending delete → keep text → text lost.
  test('pending decisions: insert dropped, delete-kept text also LOST (same bug)', () => {
    const buf = fixture();
    // Empty decision map → every change is "pending".
    const out = new TrackChangesService().applyDecisions(buf, new Map());
    assert.equal(out, 'The quick fox'); // see NOTE above; "lazy" should have survived
  });

  // Index-stability check: an empty insert sits BEFORE a real insert in the XML.
  // parseDocx skips the empty one, and applyDecisions must NOT advance insIdx for
  // it — so the real insert is still addressed as ins-0-0, not ins-0-1.
  test('an empty insert does not consume a change index (real insert stays ins-0-0)', () => {
    const para =
      `<w:p>${run('A ')}` +
      `<w:ins w:id="5" w:author="X" w:date="d"><w:r><w:t></w:t></w:r></w:ins>` + // empty, skipped
      ins('Y', 'd', 'real ') +                                                    // ins-0-0
      `${run('B')}</w:p>`;
    const buf = buildDocx([para]);

    const report = new TrackChangesService().parseDocx(buf);
    assert.equal(report.totalChanges, 1);
    assert.equal(report.changes[0].id, 'ins-0-0');

    // Accepting ins-0-0 should keep "real ".
    const out = new TrackChangesService().applyDecisions(
      buf,
      new Map<string, ChangeStatus>([['ins-0-0', 'accepted']]),
    );
    assert.equal(out, 'A real B');
  });
});
