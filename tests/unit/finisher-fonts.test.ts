import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { DocxPackage, descByTag, childByTag, getW, W } from '../../gateway/src/services/format-finisher/ooxml.js';
import { fontTo, fontSub, fontSizeChange, type Ctx } from '../../gateway/src/services/format-finisher/transforms.js';
import { FinishInputError } from '../../gateway/src/services/format-finisher/errors.js';

function load(body: string): DocxPackage {
  const document = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(document));
  return DocxPackage.load(zip.toBuffer());
}
const runFont = (ascii: string, text: string) => `<w:p><w:r><w:rPr><w:rFonts w:ascii="${ascii}" w:hAnsi="${ascii}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
const runSize = (half: string, text: string) => `<w:p><w:r><w:rPr><w:sz w:val="${half}"/><w:szCs w:val="${half}"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
const ctx = (pkg: DocxPackage, opts = {}): Ctx => ({ pkg, paras: [], range: [0, 0], opts });
const rFontsList = (pkg: DocxPackage) => descByTag(pkg.documentXml as any, 'rFonts');

test('fontTo converts every rFonts attr but honours the skip list', () => {
  const pkg = load(runFont('Arial', 'a') + runFont('Roboto Mono', 'b'));
  fontTo(ctx(pkg, { fontTo: 'Times New Roman', fontSkip: ['Roboto Mono'] }));
  const [arial, roboto] = rFontsList(pkg);
  assert.equal(getW(arial, 'ascii'), 'Times New Roman');
  assert.equal(getW(arial, 'hAnsi'), 'Times New Roman');
  assert.equal(getW(arial, 'cs'), 'Times New Roman'); // all four set
  assert.equal(getW(roboto, 'ascii'), 'Roboto Mono'); // skipped, untouched
});

test('fontSizeChange rewrites matching sz/szCs half-points', () => {
  const pkg = load(runSize('18', 'nine pt') + runSize('24', 'twelve pt'));
  fontSizeChange(ctx(pkg, { fontSizeChange: { from: 9, to: 11 } }));
  const szs = descByTag(pkg.documentXml as any, 'sz').map((e) => getW(e, 'val'));
  assert.deepEqual(szs, ['22', '24']); // 18→22, 24 untouched
});

test('fontSub swaps one font and applies a colour', () => {
  const pkg = load(runFont('OldFace', 'x'));
  fontSub(ctx(pkg, { fontSub: { from: 'OldFace', to: 'NewFace', color: '000000' } }));
  const rf = rFontsList(pkg)[0];
  assert.equal(getW(rf, 'ascii'), 'NewFace');
  const rPr = rf.parentNode as unknown as Element;
  assert.equal(getW(childByTag(rPr, 'color')!, 'val'), '000000');
});

test('fontSub maps the "green" name to 00FF00 and rejects an invalid colour', () => {
  const pkg = load(runFont('OldFace', 'x'));
  fontSub(ctx(pkg, { fontSub: { from: 'OldFace', to: 'NewFace', color: 'green' } }));
  const rPr = rFontsList(pkg)[0].parentNode as unknown as Element;
  assert.equal(getW(childByTag(rPr, 'color')!, 'val'), '00FF00');
  assert.throws(() => fontSub(ctx(load(runFont('OldFace', 'x')), { fontSub: { from: 'OldFace', to: 'X', color: 'navy' } })), FinishInputError);
});
