import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { DocxPackage, bodyParagraphs, paraText, hasBottomBorder, childByTag, getW, W } from '../../gateway/src/services/format-finisher/ooxml.js';
import { fixHrules, fixToc, ensureMarkerSpacing, type Ctx } from '../../gateway/src/services/format-finisher/transforms.js';

const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
function load(body: string): DocxPackage {
  const document = `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:mc="${MC}"><w:body>${body}</w:body></w:document>`;
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(document));
  return DocxPackage.load(zip.toBuffer());
}
const h1 = (t: string) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const h2empty = '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr></w:p>';
const b = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const hr = '<w:p><w:r><mc:AlternateContent><mc:Fallback/></mc:AlternateContent></w:r></w:p>';
const ctx = (pkg: DocxPackage, opts = {}): Ctx => { const paras = bodyParagraphs(pkg.documentXml); return { pkg, paras, range: [0, paras.length], opts }; };
const isCentered = (p: Element) => { const pPr = childByTag(p, 'pPr'); const jc = pPr && childByTag(pPr, 'jc'); return !!jc && getW(jc, 'val') === 'center'; };

test('fixHrules converts a body-context rule to a centered "* * *"', () => {
  const pkg = load(b('a body line') + hr + b('more body'));
  fixHrules(ctx(pkg));
  const marker = bodyParagraphs(pkg.documentXml)[1];
  assert.equal(paraText(marker).trim(), '* * *');
  assert.equal(isCentered(marker), true);
  assert.equal(pkg.documentXml.getElementsByTagNameNS(MC, 'AlternateContent').length, 0);
});

test('fixHrules makes a chapter-context rule a bottom border (no marker)', () => {
  const pkg = load(h1('Chapter 1') + hr + b('body'));
  fixHrules(ctx(pkg));
  const ruled = bodyParagraphs(pkg.documentXml)[1];
  assert.equal(hasBottomBorder(ruled), true);
  assert.notEqual(paraText(ruled).trim(), '* * *');
});

test('fixHrules adds a bottom border to an empty Heading-2 separator', () => {
  const pkg = load(b('a') + h2empty + b('z'));
  fixHrules(ctx(pkg));
  assert.equal(hasBottomBorder(bodyParagraphs(pkg.documentXml)[1]), true);
});

test('ensureMarkerSpacing flanks a "* * *" marker with blank lines', () => {
  const pkg = load(b('a body line') + hr + b('more body'));
  fixHrules(ctx(pkg));
  ensureMarkerSpacing(ctx(pkg));
  const paras = bodyParagraphs(pkg.documentXml);
  const mi = paras.findIndex((p) => paraText(p).trim() === '* * *');
  assert.equal(paraText(paras[mi - 1]).trim(), '');
  assert.equal(paraText(paras[mi + 1]).trim(), '');
});

test('fixToc drops a TOC entry whose target is outside the chapter range', () => {
  // Range = Chapter 1 onward; the front-matter TOC entry (anchor _Toc0 → idx 0)
  // must be dropped, the in-range entry (anchor _Toc1 → the Chapter 1 heading) kept.
  const pkg = load(
    '<w:p><w:bookmarkStart w:id="0" w:name="_Toc0"/><w:r><w:t>Copyright</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:bookmarkStart w:id="1" w:name="_Toc1"/><w:r><w:t>Chapter 1</w:t></w:r></w:p>' +
    '<w:sdt><w:sdtContent>' +
    '<w:p><w:hyperlink w:anchor="_Toc0"><w:r><w:t>Copyright</w:t></w:r></w:hyperlink></w:p>' +
    '<w:p><w:hyperlink w:anchor="_Toc1"><w:r><w:t>Chapter 1</w:t></w:r></w:hyperlink></w:p>' +
    '<w:p><w:r><w:instrText>TOC \\o</w:instrText></w:r></w:p>' +
    '</w:sdtContent></w:sdt>',
  );
  const paras = bodyParagraphs(pkg.documentXml);
  fixToc({ pkg, paras, range: [1, paras.length], opts: { range: { start: 'Chapter 1' } } });
  const texts = bodyParagraphs(pkg.documentXml).map((p) => paraText(p).trim());
  assert.equal(texts.filter((t) => t === 'Copyright').length, 1); // body para only — the out-of-range TOC link dropped
  assert.equal(texts.filter((t) => t === 'Chapter 1').length, 2); // heading + the kept in-range TOC link
  assert.equal(pkg.documentXml.getElementsByTagNameNS(W, 'sdt').length, 0);
});

test('fixToc unwraps the TOC sdt into the body and strips field runs', () => {
  const pkg = load(
    '<w:sdt><w:sdtPr/><w:sdtContent>' +
    '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>TOC \\o "1-3"</w:instrText></w:r></w:p>' +
    '<w:p><w:hyperlink w:anchor="_Toc1"><w:r><w:t>Chapter 1</w:t></w:r></w:hyperlink></w:p>' +
    '</w:sdtContent></w:sdt>' + b('body'),
  );
  fixToc(ctx(pkg));
  assert.equal(pkg.documentXml.getElementsByTagNameNS(W, 'sdt').length, 0);
  assert.equal(pkg.documentXml.getElementsByTagNameNS(W, 'instrText').length, 0);
  assert.equal(bodyParagraphs(pkg.documentXml).some((p) => paraText(p).includes('Chapter 1')), true);
});
