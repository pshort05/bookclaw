import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { DocxPackage, bodyParagraphs, childByTag, getW, W } from '../../gateway/src/services/format-finisher/ooxml.js';
import { lineSpacing, spaceAfter, fixFirstParagraph, type Ctx } from '../../gateway/src/services/format-finisher/transforms.js';

function load(body: string): DocxPackage {
  const document = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(document));
  return DocxPackage.load(zip.toBuffer());
}
const h1 = (t: string) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const b = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const initialPara = '<w:p><w:r><w:rPr><w:sz w:val="36"/></w:rPr><w:t>O</w:t></w:r><w:r><w:t>pening line</w:t></w:r></w:p>';
const empty = '<w:p></w:p>';
const ctx = (pkg: DocxPackage, opts = {}): Ctx => { const paras = bodyParagraphs(pkg.documentXml); return { pkg, paras, range: [0, paras.length], opts }; };
const spacing = (p: Element) => { const pPr = childByTag(p, 'pPr'); return pPr ? childByTag(pPr, 'spacing') : null; };

test('lineSpacing sets proportional auto spacing on a plain paragraph', () => {
  const pkg = load(b('plain'));
  lineSpacing(ctx(pkg, { lineSpacing: 1.5 }));
  const sp = spacing(bodyParagraphs(pkg.documentXml)[0])!;
  assert.equal(getW(sp, 'line'), '360');       // 1.5 × 240
  assert.equal(getW(sp, 'lineRule'), 'auto');
});

test('lineSpacing uses atLeast for a paragraph holding a large initial', () => {
  const pkg = load(initialPara);
  lineSpacing(ctx(pkg, { lineSpacing: 1.5 }));
  const sp = spacing(bodyParagraphs(pkg.documentXml)[0])!;
  assert.equal(getW(sp, 'lineRule'), 'atLeast');
});

test('drop-cap detection uses the real body size, not a hardcoded 12pt', () => {
  // 16pt initial over an 11pt body: 16 ≥ 1.4×11 (15.4) qualifies; a hardcoded
  // 1.4×12 (16.8) threshold would have missed it.
  const pkg = load('<w:p><w:r><w:rPr><w:sz w:val="32"/></w:rPr><w:t>O</w:t></w:r><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t>pening</w:t></w:r></w:p>');
  lineSpacing(ctx(pkg, { lineSpacing: 1.5 }));
  assert.equal(getW(spacing(bodyParagraphs(pkg.documentXml)[0])!, 'lineRule'), 'atLeast');
});

test('spaceAfter sets w:after on body text but not on blanks', () => {
  const pkg = load(b('x') + empty);
  spaceAfter(ctx(pkg, { spaceAfter: 0.25 }));
  const [body, blank] = bodyParagraphs(pkg.documentXml);
  assert.equal(getW(spacing(body)!, 'after'), '60'); // 0.25 × 12pt × 20
  assert.equal(spacing(blank), null);
});

test('fixFirstParagraph only retunes a chapter opener that holds an initial', () => {
  const pkg = load(h1('Chapter 1') + initialPara + h1('Chapter 2') + b('plain opener'));
  fixFirstParagraph(ctx(pkg, { lineSpacing: 1.5 }));
  const paras = bodyParagraphs(pkg.documentXml);
  assert.equal(getW(spacing(paras[1])!, 'lineRule'), 'atLeast'); // initial opener
  assert.equal(spacing(paras[3]), null);                          // plain opener untouched
});
