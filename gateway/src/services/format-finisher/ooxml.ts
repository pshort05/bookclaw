/**
 * Low-level Office-Open-XML (WordprocessingML) helpers for the format finisher.
 *
 * This is the only module that knows the `w:` namespace and the .docx zip
 * layout. It loads a .docx Buffer into parsed DOM documents (document.xml +
 * styles/settings/fontTable), exposes namespaced create/query/predicate
 * helpers that the pure transforms build on, and serializes the changed parts
 * back into a new .docx Buffer.
 *
 * Port of the lxml/python-docx plumbing in WritingUtils' clean_docx.py.
 */
import AdmZip from 'adm-zip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

/** WordprocessingML main namespace. */
export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** Markup-compatibility namespace (Google-Docs HR drawing shapes live here). */
export const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

export class DocxParseError extends Error {}

// We drive @xmldom/xmldom through the global DOM types (which carry all the
// methods we use); the only xmldom-specific types live at the parse/serialize
// boundary in parsePart/writePart.
type Doc = Document;
type El = Element;

/** A loaded .docx: the zip plus the parsed parts we may rewrite. */
export class DocxPackage {
  private constructor(
    private readonly zip: AdmZip,
    readonly documentXml: Doc,
    readonly stylesXml: Doc | null,
    readonly settingsXml: Doc | null,
    readonly fontTableXml: Doc | null,
  ) {}

  static load(buf: Buffer): DocxPackage {
    let zip: AdmZip;
    try { zip = new AdmZip(buf); } catch (e) { throw new DocxParseError(`not a readable .docx (zip error: ${String(e)})`); }
    const documentDoc = parsePart(zip, 'word/document.xml', true);
    if (!documentDoc) throw new DocxParseError('word/document.xml is missing — not a Word document');
    return new DocxPackage(
      zip,
      documentDoc,
      parsePart(zip, 'word/styles.xml', false),
      parsePart(zip, 'word/settings.xml', false),
      parsePart(zip, 'word/fontTable.xml', false),
    );
  }

  /** Serialize the changed parts back into the zip and return a new .docx Buffer. */
  toBuffer(): Buffer {
    writePart(this.zip, 'word/document.xml', this.documentXml);
    writePart(this.zip, 'word/styles.xml', this.stylesXml);
    writePart(this.zip, 'word/settings.xml', this.settingsXml);
    writePart(this.zip, 'word/fontTable.xml', this.fontTableXml);
    return this.zip.toBuffer();
  }

  /** Drop embedded-font binaries + scrub the font embedding metadata. */
  stripEmbeddedFonts(): void {
    for (const e of this.zip.getEntries()) {
      if (/^word\/fonts\/.*\.odttf$/i.test(e.entryName)) this.zip.deleteFile(e.entryName);
    }
    const fontRoot = this.fontTableXml?.documentElement;
    if (fontRoot) {
      for (const tag of ['embedRegular', 'embedBold', 'embedItalic', 'embedBoldItalic']) {
        for (const el of descByTag(fontRoot, tag)) el.parentNode?.removeChild(el);
      }
      // De-duplicate <w:font w:name="…"> entries, keeping the first.
      const seen = new Set<string>();
      for (const font of childrenByTag(fontRoot, 'font')) {
        const name = getW(font, 'name');
        if (name && seen.has(name)) font.parentNode?.removeChild(font);
        else if (name) seen.add(name);
      }
    }
    const settingsRoot = this.settingsXml?.documentElement;
    if (settingsRoot) {
      for (const el of descByTag(settingsRoot, 'embedTrueTypeFonts')) el.parentNode?.removeChild(el);
    }
    if (this.zip.getEntry('word/_rels/fontTable.xml.rels')) {
      this.zip.updateFile('word/_rels/fontTable.xml.rels',
        Buffer.from(`${XML_DECL}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`));
    }
  }
}

// A .docx part can compress enormously; bound the DECOMPRESSED size (the multer
// upload limit only bounds the compressed bytes) so a zip-bomb can't OOM the
// single-process gateway before we even parse it.
const MAX_PART_BYTES = 128 * 1024 * 1024;

function parsePart(zip: AdmZip, name: string, _required: boolean): Doc | null {
  const entry = zip.getEntry(name);
  if (!entry) return null;
  if (entry.header.size > MAX_PART_BYTES) {
    throw new DocxParseError(`${name} is too large to process (${entry.header.size} bytes uncompressed)`);
  }
  const xml = entry.getData().toString('utf-8');
  const errors: string[] = [];
  const doc = new DOMParser({ onError: (_l, m) => errors.push(String(m)) }).parseFromString(xml, 'text/xml') as unknown as Doc;
  if (!doc?.documentElement) throw new DocxParseError(`${name} failed to parse: ${errors.join('; ') || 'no root element'}`);
  return doc;
}

function writePart(zip: AdmZip, name: string, doc: Doc | null): void {
  if (!doc) return;
  // xmldom may re-emit the source <?xml …?> declaration; strip any leading one
  // so we control it (and never emit two, which is a fatal re-parse error).
  const serialized = new XMLSerializer().serializeToString(doc as any).replace(/^﻿?\s*<\?xml[^>]*\?>\s*/i, '');
  zip.updateFile(name, Buffer.from(XML_DECL + serialized, 'utf-8'));
}

// ── Namespaced create / query ────────────────────────────────────────────────

/** Create a `<w:local/>` element in `doc`. */
export function createW(doc: Doc, local: string): El {
  return doc.createElementNS(W, `w:${local}`);
}

/** All descendant `<w:local>` elements (any depth). */
export function descByTag(node: El | Doc, local: string): El[] {
  return Array.from(node.getElementsByTagNameNS(W, local));
}

/** Direct `<w:local>` children of `parent`. */
export function childrenByTag(parent: El, local: string): El[] {
  const out: El[] = [];
  for (let c = parent.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 1 && (c as El).namespaceURI === W && (c as El).localName === local) out.push(c as El);
  }
  return out;
}

/** First direct `<w:local>` child, or null. */
export function childByTag(parent: El, local: string): El | null {
  return childrenByTag(parent, local)[0] ?? null;
}

/** Read a `w:`-namespaced attribute. */
export function getW(el: El, local: string): string | null {
  const v = el.getAttributeNS(W, local);
  return v === '' && !el.hasAttributeNS(W, local) ? null : (v ?? null);
}

/** Set a `w:`-namespaced attribute. */
export function setW(el: El, local: string, value: string): void {
  el.setAttributeNS(W, `w:${local}`, value);
}

// ── Structure helpers ────────────────────────────────────────────────────────

export function body(doc: Doc): El {
  const root = doc.documentElement;
  if (!root) throw new DocxParseError('document has no root element');
  const b = childByTag(root, 'body');
  if (!b) throw new DocxParseError('document has no <w:body>');
  return b;
}

/** Body-level paragraphs only (direct children of <w:body>), matching python-docx `document.paragraphs`. */
export function bodyParagraphs(doc: Doc): El[] {
  return childrenByTag(body(doc), 'p');
}

/** Get the paragraph's <w:pPr>, creating it as the first child if absent. */
export function getOrCreatePPr(p: El): El {
  let pPr = childByTag(p, 'pPr');
  if (!pPr) { pPr = createW(p.ownerDocument as Doc, 'pPr'); p.insertBefore(pPr, p.firstChild); }
  return pPr;
}

/** Get a run's <w:rPr>, creating it as the first child if absent. */
export function getOrCreateRPr(r: El): El {
  let rPr = childByTag(r, 'rPr');
  if (!rPr) { rPr = createW(r.ownerDocument as Doc, 'rPr'); r.insertBefore(rPr, r.firstChild); }
  return rPr;
}

// Canonical child order for CT_PPr / CT_RPr (subset we touch). Word rejects a
// .docx whose property children are out of schema order, so inserts must respect
// these sequences.
const PPR_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl',
  'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap',
  'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid',
  'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection',
  'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];
const RPR_ORDER = ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike',
  'outline', 'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color',
  'spacing', 'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText',
  'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath'];

/**
 * Find or create the direct `<w:local>` child of `parent`, inserting a new one
 * at the schema-correct position. `parent` must be a `<w:pPr>` or `<w:rPr>`.
 */
export function ensureChild(parent: El, local: string): El {
  const existing = childByTag(parent, local);
  if (existing) return existing;
  const order = parent.localName === 'rPr' ? RPR_ORDER : PPR_ORDER;
  const rank = order.indexOf(local);
  const el = createW(parent.ownerDocument as Doc, local);
  // Insert before the first existing child whose rank is greater than ours.
  let ref: ChildNode | null = null;
  for (let c = parent.firstChild; c; c = c.nextSibling) {
    if (c.nodeType !== 1 || (c as El).namespaceURI !== W) continue;
    const cr = order.indexOf((c as El).localName as string);
    if (cr > rank) { ref = c; break; }
  }
  parent.insertBefore(el, ref);
  return el;
}

// ── Predicates ───────────────────────────────────────────────────────────────

export function paraText(p: El): string {
  return descByTag(p, 't').map((t) => t.textContent ?? '').join('');
}

/** The paragraph's style id (e.g. "Heading1"), or '' if none. */
export function paraStyle(p: El): string {
  const pPr = childByTag(p, 'pPr');
  const pStyle = pPr ? childByTag(pPr, 'pStyle') : null;
  return pStyle ? (getW(pStyle, 'val') ?? '') : '';
}

const normStyle = (s: string) => s.replace(/\s+/g, '').toLowerCase();
/** Heading style? Matches ids/names like "Heading1" / "Heading 1" … "Heading9". */
export function isHeading(p: El): boolean { return normStyle(paraStyle(p)).startsWith('heading'); }
export function isHeading1(p: El): boolean { return normStyle(paraStyle(p)) === 'heading1'; }
export function isEmptyPara(p: El): boolean { return paraText(p).trim() === ''; }

export function hasPageBreak(p: El): boolean {
  return descByTag(p, 'br').some((br) => getW(br, 'type') === 'page');
}

export function hasBottomBorder(p: El): boolean {
  const pPr = childByTag(p, 'pPr');
  const pBdr = pPr ? childByTag(pPr, 'pBdr') : null;
  const bottom = pBdr ? childByTag(pBdr, 'bottom') : null;
  if (!bottom) return false;
  const val = getW(bottom, 'val');
  return !!val && val !== 'nil' && val !== 'none';
}

/** A run's font name from any of the four <w:rFonts> attributes, or null. */
export function runFont(r: El): string | null {
  const rPr = childByTag(r, 'rPr');
  const rFonts = rPr ? childByTag(rPr, 'rFonts') : null;
  if (!rFonts) return null;
  for (const a of ['ascii', 'hAnsi', 'cs', 'eastAsia']) { const v = getW(rFonts, a); if (v) return v; }
  return null;
}

// ── Units ────────────────────────────────────────────────────────────────────

/** Points → half-points (the unit of <w:sz>/<w:szCs>). */
export function ptToHalf(pt: number): number { return Math.round(pt * 2); }
/** Inches → twips (the unit of <w:ind>, <w:spacing>). */
export function inchToTwip(inch: number): number { return Math.round(inch * 1440); }
/** Points → twips. */
export function ptToTwip(pt: number): number { return Math.round(pt * 20); }
