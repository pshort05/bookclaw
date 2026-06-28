/**
 * The DOCX finishing transforms — pure functions that mutate a parsed
 * WordprocessingML DOM. Each is a faithful port of the matching feature in
 * WritingUtils' clean_docx.py and is a no-op when its targets are absent.
 *
 * Every transform takes a Ctx carrying the package, the body paragraph list,
 * the resolved [start,end) range, and the finish options. The orchestrator
 * (finisher.ts) re-resolves paras/range before each call.
 */
import {
  W, MC, createW, setW, childByTag, childrenByTag, descByTag, getW, ensureChild,
  getOrCreatePPr, getOrCreateRPr, runFont, bodyParagraphs, paraText,
  isHeading, isHeading1, isEmptyPara, hasPageBreak, hasBottomBorder, ptToHalf, ptToTwip, inchToTwip,
  type DocxPackage,
} from './ooxml.js';

type Doc = DocxPackage['documentXml'];
import type { FinishOptions } from './types.js';
import { FinishInputError } from './errors.js';

export interface Ctx {
  pkg: DocxPackage;
  paras: Element[];
  range: [number, number];
  opts: FinishOptions;
}

/** previous element-sibling paragraph (`<w:p>`), or null. */
function prevPara(p: Element): Element | null {
  for (let s = p.previousSibling; s; s = s.previousSibling) {
    if (s.nodeType === 1 && (s as Element).namespaceURI === W && (s as Element).localName === 'p') return s as Element;
  }
  return null;
}

/** next element-sibling paragraph (`<w:p>`), or null. */
function nextPara(p: Element): Element | null {
  for (let s = p.nextSibling; s; s = s.nextSibling) {
    if (s.nodeType === 1 && (s as Element).namespaceURI === W && (s as Element).localName === 'p') return s as Element;
  }
  return null;
}

/** An empty paragraph that `clean` is allowed to drop (not a heading / border / page break). */
function removableEmpty(p: Element): boolean {
  return isEmptyPara(p) && !isHeading(p) && !hasBottomBorder(p) && !hasPageBreak(p);
}

// ── clean ────────────────────────────────────────────────────────────────────
export function clean(ctx: Ctx): void {
  const { paras, range } = ctx;
  const [s, e] = range;
  // Clear Google-Docs paragraph spacing overrides on non-heading paragraphs.
  for (let i = s; i < e; i++) {
    const p = paras[i];
    if (isHeading(p)) continue;
    const pPr = childByTag(p, 'pPr');
    const sp = pPr ? childByTag(pPr, 'spacing') : null;
    if (sp) { sp.removeAttributeNS(W, 'before'); sp.removeAttributeNS(W, 'after'); }
  }
  // Drop empty Heading-1 paragraphs (export artifacts).
  for (let i = s; i < e; i++) { const p = paras[i]; if (isHeading1(p) && isEmptyPara(p)) p.parentNode?.removeChild(p); }
  // Collapse blank-paragraph runs: a lone blank → removed; a run of ≥2 → keep one.
  let i = s;
  while (i < e) {
    if (!removableEmpty(paras[i])) { i++; continue; }
    let j = i; while (j < e && removableEmpty(paras[j])) j++;
    const keepFirst = j - i >= 2;
    for (let k = i; k < j; k++) { if (keepFirst && k === i) continue; paras[k].parentNode?.removeChild(paras[k]); }
    i = j;
  }
}

// ── ensureMarkerSpacing ───────────────────────────────────────────────────────
// Flank each "* * *" scene marker with a blank line. clean_docx.py runs this
// gated on fix_hrules, AFTER clean (so the collapse pass doesn't strip the
// blanks as lone empties) — hence a separate step rather than living in clean().
export function ensureMarkerSpacing(ctx: Ctx): void {
  const doc = ctx.pkg.documentXml as Doc;
  for (const m of bodyParagraphs(doc).filter((p) => paraText(p).trim() === '* * *')) {
    const before = prevPara(m);
    if (!before || !isEmptyPara(before)) m.parentNode?.insertBefore(createW(doc, 'p'), m);
    const after = nextPara(m);
    if (!after || !isEmptyPara(after)) m.parentNode?.insertBefore(createW(doc, 'p'), m.nextSibling);
  }
}

// ── pageBreaks ───────────────────────────────────────────────────────────────
export function pageBreaks(ctx: Ctx): void {
  const { pkg, paras, range } = ctx;
  const doc = pkg.documentXml;
  const [s, e] = range;
  for (let i = s; i < e; i++) {
    const p = paras[i];
    if (!isHeading1(p) || isEmptyPara(p)) continue;
    const prev = prevPara(p);
    if (prev && hasPageBreak(prev)) continue;
    const np = createW(doc, 'p');
    const r = createW(doc, 'r');
    const br = createW(doc, 'br');
    setW(br, 'type', 'page');
    r.appendChild(br); np.appendChild(r);
    p.parentNode?.insertBefore(np, p);
  }
}

// ── shared run/paragraph classification (used by hrules + indent + initials) ──
function runHasFlag(r: Element, flag: 'b' | 'i'): boolean {
  const rPr = childByTag(r, 'rPr');
  const el = rPr ? childByTag(rPr, flag) : null;
  if (!el) return false;
  const v = getW(el, 'val');
  return v !== '0' && v !== 'false';
}
/** A "title component" line (date / POV / location): every non-empty run is bold or italic. */
function isTitleComponent(p: Element): boolean {
  if (isEmptyPara(p)) return false;
  const runs = childrenByTag(p, 'r').filter((r) => (childByTag(r, 't')?.textContent ?? '').trim() !== '');
  if (runs.length === 0) return false;
  return runs.every((r) => runHasFlag(r, 'b') || runHasFlag(r, 'i'));
}
/** True when, scanning back over blanks + title lines, a Heading 1 precedes any body text. */
function isAfterHeadingBlock(paras: Element[], idx: number): boolean {
  for (let i = idx - 1; i >= 0; i--) {
    const p = paras[i];
    if (isEmptyPara(p) || isTitleComponent(p)) continue;
    return isHeading1(p);
  }
  return false;
}

function addBottomBorder(p: Element): void {
  const doc = p.ownerDocument as Doc;
  const pPr = getOrCreatePPr(p);
  const pBdr = ensureChild(pPr, 'pBdr');
  let bottom = childByTag(pBdr, 'bottom');
  if (!bottom) { bottom = createW(doc, 'bottom'); pBdr.appendChild(bottom); }
  setW(bottom, 'val', 'single'); setW(bottom, 'sz', '6'); setW(bottom, 'space', '1'); setW(bottom, 'color', 'A0A0A0');
  const ind = ensureChild(pPr, 'ind');
  setW(ind, 'left', '0'); setW(ind, 'right', '0');
}

function toSceneMarker(p: Element): void {
  const doc = p.ownerDocument as Doc;
  const pPr = getOrCreatePPr(p);
  const oldBdr = childByTag(pPr, 'pBdr');
  if (oldBdr) pPr.removeChild(oldBdr);
  const jc = ensureChild(pPr, 'jc');
  setW(jc, 'val', 'center');
  for (const r of childrenByTag(p, 'r')) p.removeChild(r);
  const r = createW(doc, 'r');
  const t = createW(doc, 't');
  t.textContent = '* * *';
  t.setAttribute('xml:space', 'preserve');
  r.appendChild(t);
  p.appendChild(r);
}

// ── fixHrules ────────────────────────────────────────────────────────────────
export function fixHrules(ctx: Ctx): void {
  const { paras, range } = ctx;
  const [s, e] = range;
  // Case 1: Google-Docs HR drawing shapes (mc:AlternateContent runs).
  for (let i = s; i < e; i++) {
    const p = paras[i];
    const shapes = Array.from(p.getElementsByTagNameNS(MC, 'AlternateContent') as unknown as Element[]);
    if (shapes.length === 0) continue;
    for (const node of shapes) {
      let r: Node | null = node;
      while (r && !((r as Element).namespaceURI === W && (r as Element).localName === 'r')) r = r.parentNode;
      if (r) r.parentNode?.removeChild(r);
    }
    if (isAfterHeadingBlock(paras, i)) addBottomBorder(p);
    else toSceneMarker(p);
  }
  // Case 2: empty Heading-2+ scene separators.
  for (let i = s; i < e; i++) {
    const p = paras[i];
    if (!isEmptyPara(p) || !isHeading(p) || isHeading1(p)) continue;
    if (hasBottomBorder(p) || hasPageBreak(p)) continue;
    addBottomBorder(p);
  }
}

// ── fixToc ───────────────────────────────────────────────────────────────────
export function fixToc(ctx: Ctx): void {
  const doc = ctx.pkg.documentXml as Doc;
  const [s, e] = ctx.range;
  // Map bookmark name → body-paragraph index so TOC entries can be range-filtered.
  const bookmarks = new Map<string, number>();
  bodyParagraphs(doc).forEach((p, idx) => {
    for (const b of descByTag(p, 'bookmarkStart')) { const name = getW(b, 'name'); if (name && !bookmarks.has(name)) bookmarks.set(name, idx); }
  });
  for (const sdt of Array.from(doc.getElementsByTagNameNS(W, 'sdt') as unknown as Element[])) {
    const instr = descByTag(sdt, 'instrText').map((t) => t.textContent ?? '').join(' ');
    if (!/TOC/i.test(instr)) continue;
    const content = childByTag(sdt, 'sdtContent');
    const parent = sdt.parentNode;
    if (!content || !parent) continue;
    for (const p of childrenByTag(content, 'p')) {
      // Strip field-instruction-only runs (fldChar / instrText with no visible text).
      for (const r of childrenByTag(p, 'r')) {
        const isField = !!(childByTag(r, 'fldChar') || childByTag(r, 'instrText'));
        if (isField && !childByTag(r, 't')) r.parentNode?.removeChild(r);
      }
      const link = descByTag(p, 'hyperlink')[0] ?? null;
      const anchor = link ? getW(link, 'anchor') : null;
      // Drop a TOC entry whose target resolves OUTSIDE the chapter range (front
      // matter: title page / copyright). Unresolved anchors are kept (conservative).
      if (anchor && bookmarks.has(anchor)) { const t = bookmarks.get(anchor)!; if (t < s || t >= e) continue; }
      // Drop now-empty / field-only paragraphs (no hyperlink, no visible text).
      if (!link && paraText(p).trim() === '') continue;
      parent.insertBefore(p, sdt);
    }
    parent.removeChild(sdt);
  }
}

// ── shared font/alignment predicates (indent + excerpt + initials) ────────────
function paraAlign(p: Element): string | null {
  const pPr = childByTag(p, 'pPr');
  const jc = pPr ? childByTag(pPr, 'jc') : null;
  return jc ? getW(jc, 'val') : null;
}
function isNonLeftAligned(p: Element): boolean {
  const a = paraAlign(p);
  return a === 'center' || a === 'right' || a === 'distribute';
}
// Match if ANY rFonts anywhere in the paragraph names this font — descendant
// search (mirrors clean_docx.py's `.//w:rFonts`) so paragraph-mark fonts and
// runs nested in hyperlinks count, not just direct-child runs.
function paraMatchesFont(p: Element, font: string): boolean {
  const f = font.toLowerCase();
  return descByTag(p, 'rFonts').some((rf) =>
    ['ascii', 'hAnsi', 'cs', 'eastAsia'].some((a) => { const v = getW(rf, a); return !!v && v.toLowerCase() === f; }));
}
function setInd(p: Element, attrs: Record<string, string>): void {
  const ind = ensureChild(getOrCreatePPr(p), 'ind');
  for (const [k, v] of Object.entries(attrs)) setW(ind, k, v);
}

// ── indentParagraphs ─────────────────────────────────────────────────────────
export function indentParagraphs(ctx: Ctx): void {
  const { paras, range, opts } = ctx;
  const [s, e] = range;
  let pendingFirst = false; // first body paragraph after a heading stays flush-left
  for (let i = s; i < e; i++) {
    const p = paras[i];
    if (isHeading(p)) { pendingFirst = true; continue; }
    if (isEmptyPara(p) || isTitleComponent(p)) continue;
    if (isNonLeftAligned(p)) continue;
    if (opts.excerptFont && paraMatchesFont(p, opts.excerptFont)) continue;
    if (pendingFirst) { pendingFirst = false; continue; }
    setInd(p, { firstLine: String(inchToTwip(0.25)) });
  }
}

// ── excerpt ──────────────────────────────────────────────────────────────────
export function excerpt(ctx: Ctx): void {
  const { paras, range, opts } = ctx;
  const font = opts.excerptFont;
  if (!font) return;
  const [s, e] = range;
  const twip = String(inchToTwip(0.5));
  let i = s;
  while (i < e) {
    if (!paraMatchesFont(paras[i], font)) { i++; continue; }
    // Extend the group across intervening blanks, ending on the last excerpt line.
    let k = i, last = i;
    while (k < e && (paraMatchesFont(paras[k], font) || isEmptyPara(paras[k]))) { if (paraMatchesFont(paras[k], font)) last = k; k++; }
    for (let g = i; g <= last; g++) setInd(paras[g], { left: twip, right: twip });
    const doc = ctx.pkg.documentXml as Doc;
    const before = prevPara(paras[i]);
    if (!before || !isEmptyPara(before)) paras[i].parentNode?.insertBefore(createW(doc, 'p'), paras[i]);
    const after = nextPara(paras[last]);
    if (!after || !isEmptyPara(after)) paras[last].parentNode?.insertBefore(createW(doc, 'p'), paras[last].nextSibling);
    i = k;
  }
}

// ── chapterInitial ───────────────────────────────────────────────────────────
export function chapterInitial(ctx: Ctx): void {
  const { paras, range, opts } = ctx;
  const ci = opts.chapterInitial;
  if (!ci?.font) return;
  const [s, e] = range;
  for (let i = s; i < e; i++) {
    if (!isHeading1(paras[i]) || isEmptyPara(paras[i])) continue;
    for (let j = i + 1; j < e; j++) {
      const p = paras[j];
      if (isHeading(p)) break;
      if (isEmptyPara(p) || isTitleComponent(p) || isNonLeftAligned(p)) continue;
      if (opts.excerptFont && paraMatchesFont(p, opts.excerptFont)) continue;
      styleInitial(p, ci.font, ci.size);
      break;
    }
  }
}

function styleInitial(p: Element, font: string, sizePt: number): void {
  const doc = p.ownerDocument as Doc;
  const run = childrenByTag(p, 'r').find((r) => (childByTag(r, 't')?.textContent ?? '') !== '');
  if (!run) return;
  const tEl = childByTag(run, 't');
  if (!tEl) return;
  const text = tEl.textContent ?? '';
  let pos = 0;
  while (pos < text.length && !/[A-Za-z0-9]/.test(text[pos])) pos++;
  if (pos >= text.length) return;
  const prefix = text.slice(0, pos);
  const initialChar = text[pos];
  const rest = text.slice(pos + 1);
  const rPrSrc = childByTag(run, 'rPr');
  const parent = run.parentNode!;
  const mkRun = (txt: string): Element => {
    const r = createW(doc, 'r');
    if (rPrSrc) r.appendChild(rPrSrc.cloneNode(true));
    const t = createW(doc, 't');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = txt;
    r.appendChild(t);
    return r;
  };
  if (prefix) parent.insertBefore(mkRun(prefix), run);
  const initRun = mkRun(initialChar);
  const irPr = getOrCreateRPr(initRun);
  const rFonts = ensureChild(irPr, 'rFonts');
  setW(rFonts, 'ascii', font); setW(rFonts, 'hAnsi', font);
  setW(ensureChild(irPr, 'sz'), 'val', String(ptToHalf(sizePt)));
  setW(ensureChild(irPr, 'szCs'), 'val', String(ptToHalf(sizePt)));
  parent.insertBefore(initRun, run);
  tEl.textContent = rest;
  tEl.setAttribute('xml:space', 'preserve');
}

// ── spacing helpers (lineSpacing + spaceAfter + fixFirstParagraph) ────────────
const DEFAULT_BODY_PT = 12; // style-resolution is skipped in v1; assume the Word default
function explicitRunSizePt(r: Element): number | null {
  const rPr = childByTag(r, 'rPr');
  const sz = rPr ? childByTag(rPr, 'sz') : null;
  const v = sz ? getW(sz, 'val') : null;
  return v ? Number(v) / 2 : null;
}
function nonEmptyRuns(p: Element): Element[] {
  return childrenByTag(p, 'r').filter((r) => (childByTag(r, 't')?.textContent ?? '') !== '');
}
function firstRunSizePt(p: Element): number | null {
  const r = nonEmptyRuns(p)[0];
  return r ? explicitRunSizePt(r) : null;
}
/**
 * Detect a chapter drop-cap and resolve the paragraph's body text size.
 * clean_docx.py: a paragraph "holds an initial" when it has ≥2 non-empty runs
 * and the first run's size is ≥1.4× the SECOND run's (the real body size) — not
 * a hardcoded 12pt. `bodyPt` is that body size, used for AT_LEAST line height.
 */
function initialInfo(p: Element): { isInitial: boolean; bodyPt: number } {
  const runs = nonEmptyRuns(p);
  if (runs.length < 2) return { isInitial: false, bodyPt: (runs[0] ? explicitRunSizePt(runs[0]) : null) ?? DEFAULT_BODY_PT };
  const firstSz = explicitRunSizePt(runs[0]) ?? DEFAULT_BODY_PT;
  const bodyPt = explicitRunSizePt(runs[1]) ?? DEFAULT_BODY_PT;
  return { isInitial: firstSz >= 1.4 * bodyPt, bodyPt };
}
function setSpacing(p: Element, attrs: { line?: number; lineRule?: string; after?: number }): void {
  const sp = ensureChild(getOrCreatePPr(p), 'spacing');
  if (attrs.line != null) setW(sp, 'line', String(attrs.line));
  if (attrs.lineRule) setW(sp, 'lineRule', attrs.lineRule);
  if (attrs.after != null) setW(sp, 'after', String(attrs.after));
}

// ── lineSpacing ──────────────────────────────────────────────────────────────
export function lineSpacing(ctx: Ctx): void {
  const { paras, range, opts } = ctx;
  const m = opts.lineSpacing;
  if (m == null) return;
  const [s, e] = range;
  for (let i = s; i < e; i++) {
    const p = paras[i];
    if (isHeading(p)) continue;
    const { isInitial, bodyPt } = initialInfo(p);
    if (isInitial) setSpacing(p, { line: ptToTwip(bodyPt * m), lineRule: 'atLeast' });
    else setSpacing(p, { line: Math.round(240 * m), lineRule: 'auto' });
  }
}

// ── spaceAfter ───────────────────────────────────────────────────────────────
export function spaceAfter(ctx: Ctx): void {
  const { paras, range, opts } = ctx;
  const m = opts.spaceAfter;
  if (m == null) return;
  const [s, e] = range;
  for (let i = s; i < e; i++) {
    const p = paras[i];
    if (isHeading(p) || isEmptyPara(p)) continue;
    const sizePt = firstRunSizePt(p) ?? DEFAULT_BODY_PT;
    setSpacing(p, { after: Math.round(m * sizePt * 20) });
  }
}

// ── fixFirstParagraph ────────────────────────────────────────────────────────
export function fixFirstParagraph(ctx: Ctx): void {
  const { paras, range, opts } = ctx;
  const [s, e] = range;
  for (let i = s; i < e; i++) {
    if (!isHeading1(paras[i]) || isEmptyPara(paras[i])) continue;
    for (let j = i + 1; j < e; j++) {
      const p = paras[j];
      if (isHeading(p)) break;
      if (isEmptyPara(p) || isTitleComponent(p) || isNonLeftAligned(p)) continue;
      const { isInitial, bodyPt } = initialInfo(p);
      if (isInitial) setSpacing(p, { line: ptToTwip(bodyPt * (opts.lineSpacing ?? 1.0)), lineRule: 'atLeast' });
      break;
    }
  }
}

// ── font transforms (document-wide; ignore the chapter range) ─────────────────
const FONT_ATTRS = ['ascii', 'hAnsi', 'cs', 'eastAsia'];
const COLOR_NAMES: Record<string, string> = { black: '000000', white: 'FFFFFF', red: 'FF0000', green: '00FF00', blue: '0000FF', auto: 'auto' };
function parseColor(c: string): string {
  const k = c.toLowerCase();
  if (COLOR_NAMES[k]) return COLOR_NAMES[k];
  const hex = c.replace(/^#/, '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(hex)) throw new FinishInputError(`invalid colour "${c}" (use a colour name or 6-digit hex)`);
  return hex;
}
function docsOf(ctx: Ctx, withStyles: boolean): Doc[] {
  return [ctx.pkg.documentXml, withStyles ? ctx.pkg.stylesXml : null].filter((d): d is Doc => !!d);
}

export function fontTo(ctx: Ctx): void {
  const to = ctx.opts.fontTo;
  if (!to) return;
  const skip = (ctx.opts.fontSkip ?? []).map((f) => f.toLowerCase());
  for (const d of docsOf(ctx, true)) {
    for (const rf of descByTag(d, 'rFonts')) {
      const vals = FONT_ATTRS.map((a) => getW(rf, a)).filter((v): v is string => !!v).map((v) => v.toLowerCase());
      if (vals.some((v) => skip.includes(v))) continue;
      for (const a of FONT_ATTRS) setW(rf, a, to);
    }
  }
}

export function fontSub(ctx: Ctx): void {
  const sub = ctx.opts.fontSub;
  if (!sub?.from || !sub?.to) return;
  const from = sub.from.toLowerCase();
  for (const rf of descByTag(ctx.pkg.documentXml, 'rFonts')) {
    if (!FONT_ATTRS.some((a) => getW(rf, a)?.toLowerCase() === from)) continue;
    for (const a of FONT_ATTRS) setW(rf, a, sub.to);
    const rPr = rf.parentNode as Element | null;
    if (sub.color && rPr && rPr.localName === 'rPr') setW(ensureChild(rPr, 'color'), 'val', parseColor(sub.color));
  }
}

export function fontSizeChange(ctx: Ctx): void {
  const fc = ctx.opts.fontSizeChange;
  if (!fc) return;
  const fromHalf = String(ptToHalf(fc.from));
  const toHalf = String(ptToHalf(fc.to));
  for (const d of docsOf(ctx, true)) {
    for (const tag of ['sz', 'szCs']) {
      for (const el of descByTag(d, tag)) if (getW(el, 'val') === fromHalf) setW(el, 'val', toHalf);
    }
  }
}

export function stripEmbeddedFonts(ctx: Ctx): void {
  if (ctx.opts.stripEmbeddedFonts) ctx.pkg.stripEmbeddedFonts();
}
