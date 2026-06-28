import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { DocxPackage, bodyParagraphs, isEmptyPara, hasPageBreak, isHeading1, W } from '../../gateway/src/services/format-finisher/ooxml.js';
import { clean, pageBreaks, type Ctx } from '../../gateway/src/services/format-finisher/transforms.js';

function load(body: string): DocxPackage {
  const document = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(document));
  return DocxPackage.load(zip.toBuffer());
}
const h1 = (t: string) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const b = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const empty = '<w:p></w:p>';
const borderedEmpty = '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6"/></w:pBdr></w:pPr></w:p>';

function ctx(pkg: DocxPackage): Ctx {
  const paras = bodyParagraphs(pkg.documentXml);
  return { pkg, paras, range: [0, paras.length], opts: {} };
}

test('clean collapses a run of 3 empties to 1', () => {
  const pkg = load(b('a') + empty + empty + empty + b('z'));
  clean(ctx(pkg));
  const after = bodyParagraphs(pkg.documentXml);
  assert.equal(after.filter(isEmptyPara).length, 1);
  assert.equal(after.length, 3); // a, one blank, z
});

test('clean removes a lone empty between content', () => {
  const pkg = load(b('a') + empty + b('z'));
  clean(ctx(pkg));
  const after = bodyParagraphs(pkg.documentXml);
  assert.equal(after.length, 2);
});

test('clean keeps a bordered (HR) empty and removes an empty Heading 1', () => {
  const pkg = load(b('a') + borderedEmpty + h1('') + b('z'));
  clean(ctx(pkg));
  const after = bodyParagraphs(pkg.documentXml);
  assert.equal(after.some((p) => !isEmptyPara(p) || p.getElementsByTagNameNS(W, 'pBdr').length), true);
  assert.equal(after.filter(isHeading1).length, 0); // empty H1 gone
  assert.equal(after.some((p) => p.getElementsByTagNameNS(W, 'pBdr').length > 0), true); // border kept
});

test('pageBreaks inserts one break before each non-empty Heading 1, idempotently', () => {
  const pkg = load(h1('Chapter 1') + b('a') + h1('Chapter 2') + b('z'));
  pageBreaks(ctx(pkg));
  let breaks = bodyParagraphs(pkg.documentXml).filter(hasPageBreak).length;
  assert.equal(breaks, 2);
  pageBreaks(ctx(pkg)); // re-run
  breaks = bodyParagraphs(pkg.documentXml).filter(hasPageBreak).length;
  assert.equal(breaks, 2); // no duplicates
});
