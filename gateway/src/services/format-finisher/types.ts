/**
 * Finisher option schema — the UI ⇄ API contract. Mirrors the YAML keys of
 * WritingUtils' clean_docx.py, one field per feature. Every field is optional;
 * an absent/false field means "skip that transform".
 */
export interface FinishOptions {
  /** Limit most transforms to a heading range (substring match, end exclusive). */
  range?: { start?: string; end?: string };
  clean?: boolean;                 // remove blank-paragraph cruft + clear spacing overrides
  pageBreaks?: boolean;            // page break before each chapter (Heading 1)
  fixHrules?: boolean;            // HR drawing shapes → centered "* * *" / chapter border
  fixToc?: boolean;               // unwrap the TOC SDT so KDP can see it
  indentParagraphs?: boolean;     // first-line indent on body paragraphs
  fixFirstParagraph?: boolean;    // fix chapter-opening line spacing when it holds an initial
  lineSpacing?: number;           // line-spacing multiplier (e.g. 1.15)
  spaceAfter?: number;            // space-after as a font-size multiplier (e.g. 0.25)
  excerptFont?: string;           // block-indent paragraphs in this font
  chapterInitial?: { font: string; size: number }; // drop-cap font + size (pt)
  fontTo?: string;                // convert all fonts document-wide
  fontSkip?: string[];            // …except these fonts
  fontSub?: { from: string; to: string; color?: string }; // swap one font (+ optional colour)
  fontSizeChange?: { from: number; to: number };          // resize one point size → another (pt)
  stripEmbeddedFonts?: boolean;   // drop embedded font binaries + metadata
  output?: string;                // output filename (default "<base> - finished.docx")
}
