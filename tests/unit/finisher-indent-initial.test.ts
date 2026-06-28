import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { DocxPackage, bodyParagraphs, paraText, childByTag, getW, W } from '../../gateway/src/services/format-finisher/ooxml.js';
import { indentParagraphs, excerpt, chapterInitial, type Ctx } from '../../gateway/src/services/format-finisher/transforms.js';

function load(body: string): DocxPackage {
  const document = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(document));
  return DocxPackage.load(zip.toBuffer());
}
const h1 = (t: string) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const b = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const centered = (t: string) => `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const ctx = (pkg: DocxPackage, opts = {}): Ctx => { const paras = bodyParagraphs(pkg.documentXml); return { pkg, paras, range: [0, paras.length], opts }; };
const firstLine = (p: Element) => { const pPr = childByTag(p, 'pPr'); const ind = pPr && childByTag(pPr, 'ind'); return ind ? getW(ind, 'firstLine') : null; };

test('indentParagraphs indents body text, skipping heading/centered/first-after-heading', () => {
  const pkg = load(h1('Chapter 1') + b('opening line') + b('second para') + centered('a centered line') + b('third para'));
  indentParagraphs(ctx(pkg));
  const [h, opening, second, cen, third] = bodyParagraphs(pkg.documentXml);
  assert.equal(firstLine(h), null);            // heading
  assert.equal(firstLine(opening), null);      // first body after heading
  assert.equal(firstLine(second), '360');      // indented
  assert.equal(firstLine(cen), null);          // centered
  assert.equal(firstLine(third), '360');       // indented
});

test('excerpt block-indents a matching-font paragraph and flanks it with blanks', () => {
  const exc = '<w:p><w:r><w:rPr><w:rFonts w:ascii="Courier"/></w:rPr><w:t>a quote</w:t></w:r></w:p>';
  const pkg = load(b('before') + exc + b('after'));
  excerpt(ctx(pkg, { excerptFont: 'Courier' }));
  const paras = bodyParagraphs(pkg.documentXml);
  const ei = paras.findIndex((p) => paraText(p) === 'a quote');
  const pPr = childByTag(paras[ei], 'pPr')!;
  const ind = childByTag(pPr, 'ind')!;
  assert.equal(getW(ind, 'left'), '720');
  assert.equal(getW(ind, 'right'), '720');
  assert.equal(paraText(paras[ei - 1]).trim(), '');
  assert.equal(paraText(paras[ei + 1]).trim(), '');
});

test('excerpt detects a font nested inside a hyperlink run (descendant search)', () => {
  const exc = '<w:p><w:hyperlink w:anchor="x"><w:r><w:rPr><w:rFonts w:ascii="Courier"/></w:rPr><w:t>linked quote</w:t></w:r></w:hyperlink></w:p>';
  const pkg = load(b('before') + exc + b('after'));
  excerpt(ctx(pkg, { excerptFont: 'Courier' }));
  const target = bodyParagraphs(pkg.documentXml).find((p) => paraText(p) === 'linked quote')!;
  assert.equal(getW(childByTag(childByTag(target, 'pPr')!, 'ind')!, 'left'), '720');
});

test('chapterInitial splits and styles the first letter after a Heading 1', () => {
  const pkg = load(h1('Chapter 1') + b('Opening line'));
  chapterInitial(ctx(pkg, { chapterInitial: { font: 'Palatino Linotype', size: 12 } }));
  const body = bodyParagraphs(pkg.documentXml)[1];
  assert.equal(paraText(body), 'Opening line'); // text preserved
  const firstRun = body.getElementsByTagNameNS(W, 'r')[0] as unknown as Element;
  assert.equal(childByTag(firstRun, 't')!.textContent, 'O');
  const rPr = childByTag(firstRun, 'rPr')!;
  assert.equal(getW(childByTag(rPr, 'rFonts')!, 'ascii'), 'Palatino Linotype');
  assert.equal(getW(childByTag(rPr, 'sz')!, 'val'), '24'); // 12pt → 24 half-points
});
