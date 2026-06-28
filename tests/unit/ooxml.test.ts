import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import {
  DocxPackage, W, bodyParagraphs, paraText, isHeading1, isEmptyPara,
  hasPageBreak, ptToHalf, inchToTwip,
} from '../../gateway/src/services/format-finisher/ooxml.js';

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
function docx(body: string): Buffer {
  const document = `${DECL}<w:document xmlns:w="${W}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>${body}</w:body></w:document>`;
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(`${DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`));
  zip.addFile('_rels/.rels', Buffer.from(`${DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`));
  zip.addFile('word/document.xml', Buffer.from(document));
  return zip.toBuffer();
}

test('DocxPackage loads body paragraphs and reads text', () => {
  const pkg = DocxPackage.load(docx('<w:p><w:r><w:t>hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p>'));
  const paras = bodyParagraphs(pkg.documentXml);
  assert.equal(paras.length, 1);
  assert.equal(paraText(paras[0]), 'hello world');
});

test('round-trips to a re-loadable buffer', () => {
  const pkg = DocxPackage.load(docx('<w:p><w:r><w:t>keep me</w:t></w:r></w:p>'));
  const out = pkg.toBuffer();
  const reloaded = DocxPackage.load(out);
  assert.equal(paraText(bodyParagraphs(reloaded.documentXml)[0]), 'keep me');
});

test('predicates: heading1, empty, page-break', () => {
  const pkg = DocxPackage.load(docx(
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter 1</w:t></w:r></w:p>' +
    '<w:p></w:p>' +
    '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
  ));
  const [h, empty, brk] = bodyParagraphs(pkg.documentXml);
  assert.equal(isHeading1(h), true);
  assert.equal(isHeading1(empty), false);
  assert.equal(isEmptyPara(empty), true);
  assert.equal(isEmptyPara(h), false);
  assert.equal(hasPageBreak(brk), true);
  assert.equal(hasPageBreak(h), false);
});

test('unit conversions', () => {
  assert.equal(ptToHalf(9), 18);
  assert.equal(ptToHalf(11), 22);
  assert.equal(inchToTwip(0.25), 360);
  assert.equal(inchToTwip(0.5), 720);
});

test('missing word/document.xml throws DocxParseError', () => {
  const zip = new AdmZip();
  zip.addFile('hello.txt', Buffer.from('not a docx'));
  assert.throws(() => DocxPackage.load(zip.toBuffer()), /document\.xml/);
});
