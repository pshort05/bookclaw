import { useEffect, useState } from 'react';
import { Button, useBooks, useActiveBook, useStore } from '@bookclaw/shared';
import { listBookFiles, bookFilePath, downloadFile } from '../lib/filesExplorerApi.js';
import { finishDocx, uploadDocx, kdpBlurb, proposeAmsCampaigns, bookbubDraft, type FinishOptions } from '../lib/publishApi.js';
import { useRef } from 'react';
import styles from './Publish.module.css';

// ── Finisher form state (strings so number inputs can be blank) ───────────────
interface Form {
  clean: boolean; pageBreaks: boolean; fixHrules: boolean; fixToc: boolean;
  indentParagraphs: boolean; fixFirstParagraph: boolean; stripEmbeddedFonts: boolean;
  lineSpacing: string; spaceAfter: string;
  chapterInitialFont: string; chapterInitialSize: string;
  fontTo: string; fontSkip: string; excerptFont: string;
  fontSubFrom: string; fontSubTo: string; fontSubColor: string;
  fontSizeFrom: string; fontSizeTo: string;
  rangeStart: string; rangeEnd: string; output: string;
}
const EMPTY_FORM: Form = {
  clean: true, pageBreaks: true, fixHrules: true, fixToc: false,
  indentParagraphs: true, fixFirstParagraph: false, stripEmbeddedFonts: false,
  lineSpacing: '1.15', spaceAfter: '0.25',
  chapterInitialFont: '', chapterInitialSize: '',
  fontTo: '', fontSkip: '', excerptFont: '',
  fontSubFrom: '', fontSubTo: '', fontSubColor: '',
  fontSizeFrom: '', fontSizeTo: '', rangeStart: '', rangeEnd: '', output: '',
};

function buildOptions(f: Form): FinishOptions {
  const num = (s: string): number | undefined => (s.trim() === '' || Number.isNaN(Number(s)) ? undefined : Number(s));
  const o: FinishOptions = {};
  for (const k of ['clean', 'pageBreaks', 'fixHrules', 'fixToc', 'indentParagraphs', 'fixFirstParagraph', 'stripEmbeddedFonts'] as const) {
    if (f[k]) o[k] = true;
  }
  if (num(f.lineSpacing) != null) o.lineSpacing = num(f.lineSpacing);
  if (num(f.spaceAfter) != null) o.spaceAfter = num(f.spaceAfter);
  if (f.chapterInitialFont.trim() && num(f.chapterInitialSize) != null) o.chapterInitial = { font: f.chapterInitialFont.trim(), size: num(f.chapterInitialSize)! };
  if (f.fontTo.trim()) {
    o.fontTo = f.fontTo.trim();
    const skip = f.fontSkip.split(',').map((s) => s.trim()).filter(Boolean);
    if (skip.length) o.fontSkip = skip;
  }
  if (f.excerptFont.trim()) o.excerptFont = f.excerptFont.trim();
  if (f.fontSubFrom.trim() && f.fontSubTo.trim()) {
    o.fontSub = { from: f.fontSubFrom.trim(), to: f.fontSubTo.trim() };
    if (f.fontSubColor.trim()) o.fontSub.color = f.fontSubColor.trim();
  }
  if (num(f.fontSizeFrom) != null && num(f.fontSizeTo) != null) o.fontSizeChange = { from: num(f.fontSizeFrom)!, to: num(f.fontSizeTo)! };
  if (f.rangeStart.trim() || f.rangeEnd.trim()) o.range = { start: f.rangeStart.trim() || undefined, end: f.rangeEnd.trim() || undefined };
  if (f.output.trim()) o.output = f.output.trim();
  return o;
}

export function Publish() {
  const books = useBooks();
  const activeBook = useActiveBook();
  const loadBooks = useStore((s) => s.loadBooks);
  const [slug, setSlug] = useState('');
  const [tab, setTab] = useState<'finish' | 'launch'>('finish');

  useEffect(() => { loadBooks().catch(() => {}); }, [loadBooks]);
  useEffect(() => { if (!slug && books.length) setSlug(activeBook?.slug ?? books[0].slug); }, [books, activeBook, slug]);

  return (
    <div className={styles.scroll}>
      <div className={styles.bar}>
        <label className={styles.bookSel}>
          Book
          <select value={slug} onChange={(e) => setSlug(e.target.value)}>
            {!slug && <option value="">Select a book…</option>}
            {books.map((b) => <option key={b.slug} value={b.slug}>{b.title}</option>)}
          </select>
        </label>
        <span style={{ flex: 1 }} />
        <div className={styles.tabs}>
          <button className={tab === 'finish' ? styles.tabActive : styles.tab} onClick={() => setTab('finish')}>Format Finisher</button>
          <button className={tab === 'launch' ? styles.tabActive : styles.tab} onClick={() => setTab('launch')}>Launch</button>
        </div>
      </div>

      {!slug ? <p className={styles.hint}>Select a book to begin.</p>
        : tab === 'finish' ? <FinishTab slug={slug} /> : <LaunchTab slug={slug} title={books.find((b) => b.slug === slug)?.title ?? ''} />}
    </div>
  );
}

// ── Format Finisher ───────────────────────────────────────────────────────────
function FinishTab({ slug }: { slug: string }) {
  const [docx, setDocx] = useState<string[]>([]);
  const [path, setPath] = useState('');
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ outputPath: string; bytes: number } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const refresh = (select?: string) => {
    listBookFiles(slug)
      .then((r) => { const d = (r.files ?? []).map((f) => f.path).filter((p) => /\.docx$/i.test(p)); setDocx(d); setPath((cur) => (select && d.includes(select) ? select : cur && d.includes(cur) ? cur : d[0] ?? '')); })
      .catch(() => setDocx([]));
  };
  useEffect(() => { setResult(null); setErr(null); refresh(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setErr(null);
    uploadDocx(slug, file).then((r) => refresh(r.path)).catch((e) => setErr(`Upload failed — ${String(e?.message ?? e)}`)).finally(() => setBusy(false));
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const check = (k: keyof Form, label: string) => (
    <label className={styles.check}><input type="checkbox" checked={form[k] as boolean} onChange={(e) => set(k, e.target.checked as Form[typeof k])} />{label}</label>
  );
  const text = (k: keyof Form, label: string, placeholder = '') => (
    <label className={styles.field}><span>{label}</span><input value={form[k] as string} placeholder={placeholder} onChange={(e) => set(k, e.target.value as Form[typeof k])} /></label>
  );

  const run = () => {
    if (!slug || !path) return;
    setBusy(true); setErr(null); setResult(null);
    finishDocx(slug, path, buildOptions(form))
      .then((r) => { setResult(r); refresh(); })
      .catch((e) => setErr(String(e?.message ?? e)))
      .finally(() => setBusy(false));
  };
  const download = () => { if (result) downloadFile(bookFilePath(slug, result.outputPath), result.outputPath.replace(/.*\//, '')).catch((e) => setErr(String(e))); };

  return (
    <div className={styles.body}>
      <p className={styles.intro}>Apply KDP/print finishing to a manuscript <code>.docx</code> (compiled or uploaded). A new finished <code>.docx</code> is written beside it — the original is never changed.</p>

      <label className={styles.field}>
        <span>Source .docx</span>
        <select value={path} onChange={(e) => setPath(e.target.value)}>
          {docx.length === 0 && <option value="">No .docx in this book — compile or upload one</option>}
          {docx.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <Button variant="secondary" onClick={() => fileInput.current?.click()} disabled={busy}>Upload .docx</Button>
        <input ref={fileInput} type="file" hidden accept=".docx" onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ''; }} />
      </label>

      <fieldset className={styles.group}>
        <legend>Cleanup &amp; structure</legend>
        {check('clean', 'Remove blank-paragraph cruft')}
        {check('pageBreaks', 'Page break before each chapter')}
        {check('fixHrules', 'Scene breaks → “* * *”')}
        {check('fixToc', 'Fix KDP table of contents')}
        {check('indentParagraphs', 'First-line indent body text')}
        {check('fixFirstParagraph', 'Fix chapter-opening spacing')}
        {check('stripEmbeddedFonts', 'Strip embedded fonts')}
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Spacing</legend>
        {text('lineSpacing', 'Line spacing (×)', '1.15')}
        {text('spaceAfter', 'Space after (× font)', '0.25')}
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Drop cap (chapter initial)</legend>
        {text('chapterInitialFont', 'Font', 'Palatino Linotype')}
        {text('chapterInitialSize', 'Size (pt)', '18')}
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Fonts</legend>
        {text('fontTo', 'Convert all fonts to', 'Times New Roman')}
        {text('fontSkip', '…except (comma-separated)', 'Roboto Mono')}
        {text('excerptFont', 'Excerpt font (block-indent)', 'Roboto Mono')}
        {text('fontSubFrom', 'Swap font — from')}
        {text('fontSubTo', 'Swap font — to')}
        {text('fontSubColor', 'Swap font — colour (hex/name)')}
        {text('fontSizeFrom', 'Resize point size — from')}
        {text('fontSizeTo', 'Resize point size — to')}
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Range &amp; output</legend>
        {text('rangeStart', 'Start heading (optional)', 'Chapter 1')}
        {text('rangeEnd', 'End heading (optional, exclusive)', 'Appendix')}
        {text('output', 'Output filename (optional)')}
      </fieldset>

      <div className={styles.actions}>
        <Button variant="primary" onClick={run} disabled={busy || !path}>{busy ? 'Finishing…' : 'Finish DOCX'}</Button>
        {result && <Button variant="secondary" onClick={download}>Download {result.outputPath.replace(/.*\//, '')}</Button>}
      </div>
      {result && <p className={styles.ok}>Wrote <code>{result.outputPath}</code> ({Math.round(result.bytes / 1024)} KB).</p>}
      {err && <p className={styles.err}>{err}</p>}
    </div>
  );
}

// ── Launch (glue over existing services) ──────────────────────────────────────
function LaunchTab({ slug, title }: { slug: string; title: string }) {
  const [blurb, setBlurb] = useState('');
  const [blurbOut, setBlurbOut] = useState<string | null>(null);
  const [genre, setGenre] = useState('');
  const [author, setAuthor] = useState('');
  const [keywords, setKeywords] = useState('');
  const [budget, setBudget] = useState('10');
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const wrap = (fn: () => Promise<unknown>) => () => { setErr(null); setOut(null); fn().catch((e) => setErr(String(e?.message ?? e))); };

  const checkBlurb = wrap(async () => {
    const r = await kdpBlurb(blurb);
    setBlurbOut(`${r.characterCount ?? '?'} chars${r.limit ? ` / ${r.limit} limit` : ''}${r.withinLimit === false ? ' — over limit!' : ''}`);
  });
  const ams = wrap(async () => {
    const r = await proposeAmsCampaigns({ bookTitle: title, genre, keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean), dailyBudgetCeilingUSD: Number(budget) || 0 });
    setOut(JSON.stringify(r.campaigns, null, 2));
  });
  const bb = wrap(async () => {
    const r = await bookbubDraft({ title, authorName: author, genre, amazonBlurb: blurb });
    setOut(JSON.stringify(r.draft, null, 2));
  });

  return (
    <div className={styles.body}>
      <p className={styles.intro}>One screen for the launch last-mile. Every outward action (KDP publish, ad spend, email) is proposed only and lands in <a href="/confirmations">Confirmations</a> for approval — nothing here sends on its own.</p>

      <fieldset className={styles.group}>
        <legend>Blurb / metadata</legend>
        <label className={styles.field}><span>Book blurb</span><textarea value={blurb} onChange={(e) => setBlurb(e.target.value)} rows={4} /></label>
        <div className={styles.actions}><Button variant="secondary" onClick={checkBlurb} disabled={!blurb.trim()}>Check KDP length</Button></div>
        {blurbOut && <p className={styles.ok}>{blurbOut}</p>}
      </fieldset>

      <fieldset className={styles.group}>
        <legend>Ad copy</legend>
        <label className={styles.field}><span>Genre</span><input value={genre} onChange={(e) => setGenre(e.target.value)} /></label>
        <label className={styles.field}><span>Author name (BookBub)</span><input value={author} onChange={(e) => setAuthor(e.target.value)} /></label>
        <label className={styles.field}><span>AMS keywords (comma-separated)</span><input value={keywords} onChange={(e) => setKeywords(e.target.value)} /></label>
        <label className={styles.field}><span>AMS daily budget ceiling ($)</span><input value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={ams} disabled={!title || !genre}>Propose AMS campaigns</Button>
          <Button variant="secondary" onClick={bb} disabled={!title || !author || !genre || !blurb.trim()}>Draft BookBub</Button>
        </div>
      </fieldset>

      {out && <pre className={styles.out}>{out}</pre>}
      {err && <p className={styles.err}>{err}</p>}
    </div>
  );
}
