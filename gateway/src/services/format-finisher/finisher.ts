/**
 * FormatFinisher — orchestrates the DOCX finishing transforms in the fixed
 * order ported from clean_docx.py, re-resolving the paragraph list + range
 * before each transform (transforms add/remove paragraphs). `finish` works on a
 * Buffer; `finishBookFile` reads/writes a file confined to a book's
 * data/|templates/ subtree.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { DocxPackage, bodyParagraphs } from './ooxml.js';
import { resolveRange } from './range.js';
import { mapRunnerPath } from '../runner-files.js';
import type { FinishOptions } from './types.js';
import { FinishInputError } from './errors.js';
import {
  clean, ensureMarkerSpacing, pageBreaks, fixHrules, fixToc, indentParagraphs, excerpt, chapterInitial,
  lineSpacing, fixFirstParagraph, spaceAfter, fontTo, fontSub, fontSizeChange, stripEmbeddedFonts,
  type Ctx,
} from './transforms.js';

export { FinishInputError };

interface Deps { books?: { bookDir(slug: string): string | null | undefined }; log?: (msg: string) => void }

export class FormatFinisher {
  constructor(private readonly deps: Deps = {}) {}

  /** Apply the enabled transforms to a .docx Buffer and return a new .docx Buffer. */
  finish(buf: Buffer, opts: FinishOptions): Buffer {
    const pkg = DocxPackage.load(buf);
    // Validate the range once up front: a provided start/end that matches no
    // heading is a user error (clean_docx.py aborts) — fail before any mutation
    // rather than silently finishing the whole document.
    if (opts.range?.start || opts.range?.end) {
      resolveRange(bodyParagraphs(pkg.documentXml), opts.range.start, opts.range.end, true);
    }
    const run = (label: string, fn: (ctx: Ctx) => void): void => {
      const paras = bodyParagraphs(pkg.documentXml);
      const range = resolveRange(paras, opts.range?.start, opts.range?.end);
      fn({ pkg, paras, range, opts });
      this.deps.log?.(`finisher: ${label}`);
    };
    // Fixed order (clean_docx.py): fix_toc → fix_hrules → clean → marker spacing
    // (gated on fix_hrules, after clean) → page_breaks → … → font_sub → font_to.
    if (opts.fixToc) run('fixToc', fixToc);
    if (opts.fixHrules) run('fixHrules', fixHrules);
    if (opts.clean) run('clean', clean);
    if (opts.fixHrules) run('ensureMarkerSpacing', ensureMarkerSpacing);
    if (opts.pageBreaks) run('pageBreaks', pageBreaks);
    if (opts.indentParagraphs) run('indentParagraphs', indentParagraphs);
    if (opts.excerptFont) run('excerpt', excerpt);
    if (opts.chapterInitial?.font) run('chapterInitial', chapterInitial);
    if (opts.lineSpacing != null) run('lineSpacing', lineSpacing);
    if (opts.fixFirstParagraph) run('fixFirstParagraph', fixFirstParagraph);
    if (opts.spaceAfter != null) run('spaceAfter', spaceAfter);
    if (opts.fontSub) run('fontSub', fontSub);
    if (opts.fontTo) run('fontTo', fontTo);
    if (opts.fontSizeChange) run('fontSizeChange', fontSizeChange);
    if (opts.stripEmbeddedFonts) run('stripEmbeddedFonts', stripEmbeddedFonts);
    return pkg.toBuffer();
  }

  /** Finish a .docx living under a book's data/|templates/ subtree; write a new file beside it. */
  finishBookFile(slug: string, inputRel: string, opts: FinishOptions): { outputPath: string; bytes: number } {
    const bookDir = this.deps.books?.bookDir(slug);
    if (!bookDir) throw new FinishInputError('book not found');
    const mapped = mapRunnerPath(bookDir, inputRel);
    if (!mapped) throw new FinishInputError('path must be under data/ or templates/');
    if (!/\.docx$/i.test(mapped.filename)) throw new FinishInputError('input must be a .docx file');
    const inputPath = join(mapped.baseDir, mapped.filename);
    if (!existsSync(inputPath)) throw new FinishInputError('input file not found');

    const out = this.finish(readFileSync(inputPath), opts);

    const base = mapped.filename.replace(/.*[\\/]/, '').replace(/\.docx$/i, '');
    let name = (opts.output ?? '').trim() || `${base} - finished.docx`;
    if (!/\.docx$/i.test(name)) name += '.docx';
    name = name.replace(/.*[\\/]/, ''); // never let output escape the input's directory
    const outDir = dirname(inputPath);
    name = uniqueName(outDir, name);
    writeFileSync(join(outDir, name), out);
    return { outputPath: relative(bookDir, join(outDir, name)).split(sep).join('/'), bytes: out.length };
  }
}

function uniqueName(dir: string, name: string): string {
  if (!existsSync(join(dir, name))) return name;
  const base = name.replace(/\.docx$/i, '');
  for (let n = 2; ; n++) { const cand = `${base}-${n}.docx`; if (!existsSync(join(dir, cand))) return cand; }
}
