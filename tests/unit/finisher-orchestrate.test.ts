import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import AdmZip from 'adm-zip';
import { DocxPackage, bodyParagraphs, paraText, hasPageBreak, W } from '../../gateway/src/services/format-finisher/ooxml.js';
import { FormatFinisher, FinishInputError } from '../../gateway/src/services/format-finisher/index.js';

const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
function docxBuf(body: string): Buffer {
  const document = `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:mc="${MC}"><w:body>${body}</w:body></w:document>`;
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
  zip.addFile('word/document.xml', Buffer.from(document));
  return zip.toBuffer();
}
const h1 = (t: string) => `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
const b = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const hr = '<w:p><w:r><mc:AlternateContent><mc:Fallback/></mc:AlternateContent></w:r></w:p>';

test('finish with no options is a faithful no-op (body text preserved)', () => {
  const fin = new FormatFinisher({});
  const out = fin.finish(docxBuf(h1('Chapter 1') + b('hello world')), {});
  const paras = bodyParagraphs(DocxPackage.load(out).documentXml);
  assert.equal(paras.map(paraText).join('|'), 'Chapter 1|hello world');
});

test('finish applies multiple transforms', () => {
  const fin = new FormatFinisher({});
  const out = fin.finish(docxBuf(h1('Chapter 1') + b('body')), { pageBreaks: true, lineSpacing: 1.5 });
  assert.equal(bodyParagraphs(DocxPackage.load(out).documentXml).filter(hasPageBreak).length, 1);
});

test('hrules runs before clean (marker survives, blanks inserted)', () => {
  const fin = new FormatFinisher({});
  const out = fin.finish(docxBuf(b('a body line') + hr + b('more body')), { fixHrules: true, clean: true });
  const paras = bodyParagraphs(DocxPackage.load(out).documentXml);
  const mi = paras.findIndex((p) => paraText(p).trim() === '* * *');
  assert.ok(mi > 0);
  assert.equal(paraText(paras[mi - 1]).trim(), '');
  assert.equal(paraText(paras[mi + 1]).trim(), '');
});

test('fontSub runs before fontTo (the colour swap survives a full font conversion)', () => {
  const fin = new FormatFinisher({});
  const body = `<w:p><w:r><w:rPr><w:rFonts w:ascii="Code"/></w:rPr><w:t>x</w:t></w:r></w:p>`;
  const out = fin.finish(docxBuf(body), { fontSub: { from: 'Code', to: 'Mono', color: 'FF0000' }, fontTo: 'Times New Roman' });
  const xml = new AdmZip(out).readAsText('word/document.xml');
  // If fontTo had run first, 'Code' would already be 'Times New Roman' and fontSub
  // would match nothing → no colour. The colour proves fontSub ran first.
  assert.match(xml, /w:color[^>]*FF0000/);
  assert.match(xml, /w:ascii="Times New Roman"/); // fontTo still converted the run afterwards
});

test('marker spacing is gated on fixHrules, not clean', () => {
  const fin = new FormatFinisher({});
  const out = fin.finish(docxBuf(b('a body line') + hr + b('more body')), { fixHrules: true, clean: false });
  const paras = bodyParagraphs(DocxPackage.load(out).documentXml);
  const mi = paras.findIndex((p) => paraText(p).trim() === '* * *');
  assert.equal(paraText(paras[mi - 1]).trim(), '');
  assert.equal(paraText(paras[mi + 1]).trim(), '');
});

test('finish rejects an unmatched range marker (FinishInputError)', () => {
  const fin = new FormatFinisher({});
  assert.throws(() => fin.finish(docxBuf(h1('Chapter 1') + b('x')), { range: { start: 'Nonexistent' }, pageBreaks: true }), FinishInputError);
});

test('finishBookFile writes "<base> - finished.docx" and auto-suffixes on collision', () => {
  const bookDir = mkdtempSync(join(tmpdir(), 'bk-'));
  mkdirSync(join(bookDir, 'data'));
  writeFileSync(join(bookDir, 'data', 'manuscript.docx'), docxBuf(h1('Chapter 1') + b('text')));
  const fin = new FormatFinisher({ books: { bookDir: () => bookDir } });

  const r1 = fin.finishBookFile('slug', 'data/manuscript.docx', { pageBreaks: true });
  assert.equal(r1.outputPath, 'data/manuscript - finished.docx');
  assert.ok(existsSync(join(bookDir, 'data', 'manuscript - finished.docx')));
  assert.ok(r1.bytes > 0);

  const r2 = fin.finishBookFile('slug', 'data/manuscript.docx', { pageBreaks: true });
  assert.equal(r2.outputPath, 'data/manuscript - finished-2.docx');
});

test('finishBookFile rejects a non-.docx and an out-of-tree path', () => {
  const bookDir = mkdtempSync(join(tmpdir(), 'bk-'));
  mkdirSync(join(bookDir, 'data'));
  writeFileSync(join(bookDir, 'data', 'note.txt'), 'hi');
  const fin = new FormatFinisher({ books: { bookDir: () => bookDir } });
  assert.throws(() => fin.finishBookFile('slug', 'data/note.txt', {}), FinishInputError);
  assert.throws(() => fin.finishBookFile('slug', 'book.json', {}), FinishInputError);
});
