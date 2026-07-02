/**
 * Bug L10: extractDocxText must bound the DECOMPRESSED size of word/document.xml
 * BEFORE inflating it, so a DEFLATE zip-bomb can't OOM the single-process
 * gateway. The multer upload limit only bounds the COMPRESSED bytes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { extractDocxText } from '../../gateway/src/services/docx-extract.js';

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
function docx(body: string): Buffer {
  const document = `${DECL}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(document));
  return zip.toBuffer();
}

test('L10: refuses (returns empty) when uncompressed part exceeds the cap — guard fires before inflation', () => {
  const buf = docx('<w:p><w:t>hello</w:t></w:p>');
  // A 10-byte cap is smaller than the real document.xml, so the size guard must
  // trip and return '' without ever calling getData().
  assert.equal(extractDocxText(buf, 10), '');
});

test('L10: extracts paragraph text under the default cap', () => {
  const buf = docx('<w:p><w:t>hello</w:t></w:p>');
  assert.equal(extractDocxText(buf), 'hello');
});

test('L10: missing word/document.xml returns empty', () => {
  const zip = new AdmZip();
  zip.addFile('hello.txt', Buffer.from('not a docx'));
  assert.equal(extractDocxText(zip.toBuffer()), '');
});
