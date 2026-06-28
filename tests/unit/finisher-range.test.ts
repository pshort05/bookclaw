import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { DocxPackage, bodyParagraphs, W } from '../../gateway/src/services/format-finisher/ooxml.js';
import { resolveRange } from '../../gateway/src/services/format-finisher/range.js';

function docx(body: string): Buffer {
  const document = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(document));
  return zip.toBuffer();
}
const heading = (t: string) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const body = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;

const paras = (xml: string) => bodyParagraphs(DocxPackage.load(docx(xml)).documentXml);

test('resolveRange matches headings case-insensitively, end exclusive', () => {
  const p = paras(heading('Prologue') + body('x') + heading('Chapter 1') + body('y') + heading('Appendix'));
  assert.deepEqual(resolveRange(p, 'chapter 1', 'appendix'), [2, 4]);
});

test('resolveRange defaults to the whole document', () => {
  const p = paras(heading('A') + body('x') + heading('B'));
  assert.deepEqual(resolveRange(p), [0, 3]);
});

test('resolveRange falls back to 0 / len when a marker is unmatched (non-strict)', () => {
  const p = paras(heading('A') + body('x'));
  assert.deepEqual(resolveRange(p, 'nope', 'alsonope'), [0, 2]);
});

test('resolveRange throws in strict mode when a marker is unmatched', () => {
  const p = paras(heading('A') + body('x'));
  assert.throws(() => resolveRange(p, 'nope', undefined, true), /No heading found containing "nope"/);
});
