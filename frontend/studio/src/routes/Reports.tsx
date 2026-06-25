import { useEffect, useState, useCallback } from 'react';
import { api, apiBase, authToken, useStore, useActiveBook } from '@bookclaw/shared';
import styles from './Reports.module.css';

type ReportKind = 'consistency' | 'beta-reader' | 'structure' | 'plot-promises' | 'prompt-run';
type ReportFormat = 'md' | 'json';

interface ReportEntry {
  id: string;
  kind: ReportKind;
  title: string;
  generatedAt: string;
  summary: string;
  formats: ReportFormat[];
}

const KIND_LABELS: Record<ReportKind, string> = {
  consistency: 'Consistency',
  'beta-reader': 'Beta Reader',
  structure: 'Structure & Length',
  'plot-promises': 'Plot Promises',
  'prompt-run': 'Prompt Run',
};

// Display order for the kind groups.
const KIND_ORDER: ReportKind[] = ['consistency', 'beta-reader', 'structure', 'plot-promises', 'prompt-run'];

// Native-download anchor URL with the ?token= query fallback (no Authorization
// header on a plain <a> download), matching the rest of the app.
function downloadUrl(slug: string, id: string, fmt: ReportFormat): string {
  const t = authToken();
  const base = `${apiBase()}/api/books/${encodeURIComponent(slug)}/reports/${encodeURIComponent(id)}?format=${fmt}&download=1`;
  return t ? `${base}&token=${encodeURIComponent(t)}` : base;
}

// Previews need the raw .md body; api() parses JSON, so fetch text directly with
// the bearer header (mirrors Files.tsx).
async function fetchReportText(slug: string, id: string): Promise<string> {
  const t = authToken();
  const url = `${apiBase()}/api/books/${encodeURIComponent(slug)}/reports/${encodeURIComponent(id)}?format=md`;
  const res = await fetch(url, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

export function Reports() {
  const loadBooks = useStore((s) => s.loadBooks);
  const books = useStore((s) => s.books);
  const activeBook = useActiveBook();

  const [slug, setSlug] = useState('');
  useEffect(() => {
    if (!slug && books.length) setSlug(activeBook?.slug ?? books[0].slug);
  }, [books, activeBook, slug]);

  const [reports, setReports] = useState<ReportEntry[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ id: string; text: string } | null>(null);

  useEffect(() => { loadBooks().catch(() => {}); }, [loadBooks]);

  const load = useCallback(() => {
    if (!slug) { setReports([]); return; }
    setErr(null);
    setViewing(null);
    api<{ reports: ReportEntry[] }>(`/api/books/${encodeURIComponent(slug)}/reports`)
      .then((r) => setReports(r.reports ?? []))
      .catch((e) => { setReports([]); setErr(`Failed to load reports — ${String(e)}`); });
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const view = async (id: string) => {
    if (viewing?.id === id) { setViewing(null); return; }
    setErr(null);
    try {
      const text = await fetchReportText(slug, id);
      setViewing({ id, text });
    } catch (e) {
      setErr(`Couldn't load report — ${String(e)}`);
    }
  };

  // The API returns newest-first; preserve that order within each kind group.
  const grouped: Record<ReportKind, ReportEntry[]> = {
    consistency: [], 'beta-reader': [], structure: [], 'plot-promises': [], 'prompt-run': [],
  };
  for (const r of reports) {
    if (grouped[r.kind]) grouped[r.kind].push(r);
  }

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Reports</h1>
      <p className={styles.sub}>
        {books.length
          ? <>Download and review the generated reports for a book.</>
          : <>No books yet — create one on the Book Board first.</>}
      </p>

      {err && <p className={styles.err}>{err}</p>}

      <div className={styles.controls}>
        <div className={styles.field}>
          <span className={styles.fl}>Book</span>
          <select
            className={styles.pick}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          >
            <option value="">Select a book…</option>
            {books.map((b) => <option key={b.slug} value={b.slug}>{b.title}</option>)}
          </select>
        </div>
      </div>

      {slug && reports.length === 0 && !err && (
        <p className={styles.empty}>No reports yet for this book.</p>
      )}

      {KIND_ORDER.map((kind) => {
        const entries = grouped[kind];
        if (entries.length === 0) return null;
        return (
          <div key={kind} className={styles.group}>
            <div className={styles.groupHeader}>{KIND_LABELS[kind]}</div>
            {entries.map((r) => (
              <div key={r.id} className={styles.report}>
                <div className={styles.reportHead}>
                  <span className={styles.title}>{r.title}</span>
                  <span className={styles.when}>{new Date(r.generatedAt).toLocaleString()}</span>
                </div>
                {r.summary && <p className={styles.summary}>{r.summary}</p>}
                <div className={styles.actions}>
                  {r.formats.includes('md') && (
                    <button className={styles.action} onClick={() => view(r.id)}>
                      {viewing?.id === r.id ? 'Hide' : 'View'}
                    </button>
                  )}
                  {r.formats.includes('md') && (
                    <a className={styles.dl} href={downloadUrl(slug, r.id, 'md')}>Download .md</a>
                  )}
                  {r.formats.includes('json') && (
                    <a className={styles.dl} href={downloadUrl(slug, r.id, 'json')}>Download .json</a>
                  )}
                </div>
                {viewing?.id === r.id && (
                  <div className={styles.viewPanel}>
                    <pre className={styles.pre}>{viewing.text}</pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
