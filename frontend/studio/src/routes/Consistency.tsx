import { useEffect, useState, useCallback } from 'react';
import { useStore, useActiveBook } from '@bookclaw/shared';
import {
  runConsistencyAudit,
  getConsistencyReport,
  subscribeConsistency,
  type ConsistencyFinding,
  type ConsistencyReport,
  type Severity,
} from '../lib/consistencyApi.js';
import styles from './Consistency.module.css';

const SEVERITY_ORDER: Severity[] = ['high', 'medium', 'low'];

function isCanonRef(b: ConsistencyFinding['b']): b is { canonSource: string; quote: string } {
  return 'canonSource' in b;
}

function FindingCard({ finding }: { finding: ConsistencyFinding }) {
  const tagClass =
    finding.severity === 'high' ? styles.tagHigh :
    finding.severity === 'medium' ? styles.tagMedium :
    styles.tagLow;

  return (
    <div className={styles.finding}>
      <div className={styles.findingHead}>
        <span className={`${styles.tag} ${tagClass}`}>{finding.severity}</span>
        <span className={styles.entityAttr}>{finding.entity} · {finding.attribute}</span>
        <span className={styles.category}>{finding.category}</span>
      </div>

      <div className={styles.locations}>
        <div className={styles.loc}>
          <div className={styles.locLabel}>Location A</div>
          <div className={styles.locChapter}>{finding.a.chapter}</div>
          {finding.a.quote && <div className={styles.locQuote}>"{finding.a.quote}"</div>}
        </div>
        <div className={styles.loc}>
          {isCanonRef(finding.b) ? (
            <>
              <div className={styles.locLabel}>Canon source</div>
              <div className={styles.locChapter}>{finding.b.canonSource}</div>
              {finding.b.quote && <div className={styles.locQuote}>"{finding.b.quote}"</div>}
            </>
          ) : (
            <>
              <div className={styles.locLabel}>Location B</div>
              <div className={styles.locChapter}>{finding.b.chapter}</div>
              {finding.b.quote && <div className={styles.locQuote}>"{finding.b.quote}"</div>}
            </>
          )}
        </div>
      </div>

      <div className={styles.explanation}>{finding.explanation}</div>
      {finding.suggestedFix && (
        <div className={styles.fix}>
          <span className={styles.fixLabel}>Suggested fix: </span>
          {finding.suggestedFix}
        </div>
      )}
    </div>
  );
}

export function Consistency() {
  const loadBooks = useStore((s) => s.loadBooks);
  const books = useStore((s) => s.books);
  const activeBook = useActiveBook();

  const [slug, setSlug] = useState('');
  useEffect(() => {
    if (!slug && books.length) setSlug(activeBook?.slug ?? books[0].slug);
  }, [books, activeBook, slug]);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [report, setReport] = useState<ConsistencyReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => { loadBooks().catch(() => {}); }, [loadBooks]);

  // Subscribe to socket events for the duration of the component's life.
  useEffect(() => {
    return subscribeConsistency({
      onProgress: (e) => {
        if (e.slug === slug) setProgress(e.message);
      },
      onComplete: (e) => {
        if (e.slug === slug) {
          setReport(e.report);
          setRunning(false);
          setProgress(null);
        }
      },
      onError: (e) => {
        if (e.slug === slug) {
          setErr(`Audit failed — ${e.error}`);
          setRunning(false);
          setProgress(null);
        }
      },
    });
  }, [slug]);

  // Load any existing report when the book changes.
  const loadReport = useCallback(() => {
    if (!slug) return;
    setReport(null);
    setErr(null);
    setUnavailable(false);
    getConsistencyReport(slug)
      .then((r) => setReport(r))
      .catch((e: Error & { status?: number }) => {
        if (e.status === 503) {
          setUnavailable(true);
        } else {
          setErr(`Failed to load report — ${String(e)}`);
        }
      });
  }, [slug]);

  useEffect(() => { loadReport(); }, [loadReport]);

  async function runAudit() {
    if (!slug || running) return;
    setRunning(true);
    setErr(null);
    setProgress('Starting…');
    setUnavailable(false);
    try {
      await runConsistencyAudit(slug);
      // Progress and completion arrive via socket events.
    } catch (e: unknown) {
      const err = e as Error & { status?: number };
      if (err.status === 503) {
        setUnavailable(true);
        setRunning(false);
        setProgress(null);
      } else {
        setErr(`Failed to start audit — ${String(e)}`);
        setRunning(false);
        setProgress(null);
      }
    }
  }

  // Group findings by severity then category.
  const grouped: Record<Severity, Record<string, ConsistencyFinding[]>> = {
    high: {}, medium: {}, low: {},
  };
  if (report) {
    for (const f of report.findings) {
      if (!grouped[f.severity][f.category]) grouped[f.severity][f.category] = [];
      grouped[f.severity][f.category].push(f);
    }
  }

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Consistency Auditor</h1>
      <p className={styles.sub}>
        {books.length
          ? <>Scan a book's chapters for contradictions, continuity errors, and canon divergences.</>
          : <>No books yet — create one on the Book Board first.</>}
      </p>

      {err && <p className={styles.err}>{err}</p>}
      {unavailable && (
        <p className={styles.unavailable}>
          Consistency DB is unavailable — the SQLite native module did not load on this server.
          Check the server logs for details.
        </p>
      )}

      <div className={styles.controls}>
        <div className={styles.field}>
          <span className={styles.fl}>Book</span>
          <select
            className={styles.pick}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            disabled={running}
          >
            <option value="">Select a book…</option>
            {books.map((b) => <option key={b.slug} value={b.slug}>{b.title}</option>)}
          </select>
        </div>

        <button
          className={styles.runBtn}
          onClick={runAudit}
          disabled={!slug || running}
        >
          {running ? 'Running…' : 'Run audit'}
        </button>
      </div>

      {progress && <p className={styles.progress}>{progress}</p>}

      {report && !running && (
        <>
          <p className={styles.reportMeta}>
            {report.chaptersScanned} {report.chaptersScanned === 1 ? 'chapter' : 'chapters'} scanned
            {' · '}{report.factCount} facts
            {' · '}{new Date(report.generatedAt).toLocaleString()}
          </p>

          {report.findings.length === 0 ? (
            <p className={styles.empty}>No findings — no inconsistencies detected.</p>
          ) : (
            SEVERITY_ORDER.map((sev) => {
              const categories = grouped[sev];
              const hasFindings = Object.values(categories).some((f) => f.length > 0);
              if (!hasFindings) return null;
              return (
                <div key={sev} className={styles.group}>
                  <div className={styles.groupHeader}>{sev} severity</div>
                  {Object.entries(categories).map(([cat, findings]) =>
                    findings.map((f, i) => (
                      <FindingCard key={`${cat}-${i}`} finding={f} />
                    ))
                  )}
                </div>
              );
            })
          )}

          {report.orphanFacts && report.orphanFacts.length > 0 && (
            <div className={styles.group}>
              <div className={styles.groupHeader}>
                Orphan worldbuilding ({report.orphanFacts.length}) — declared in canon, never dramatized
              </div>
              {report.orphanFacts.map((o, i) => (
                <div key={`orphan-${i}`} className={styles.finding} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span className={styles.entityAttr}>{o.entity} · {o.attribute}</span>
                  <span className={styles.locQuote}>{o.valueRaw}</span>
                  {o.world && <span className={styles.category}>World: {o.world}</span>}
                </div>
              ))}
            </div>
          )}

          {report.reverseIndex && report.reverseIndex.length > 0 && (
            <div className={styles.group}>
              <div className={styles.groupHeader}>
                Impact index — edit a fact → revisit these chapters ({report.reverseIndex.length})
              </div>
              {report.reverseIndex.slice(0, 50).map((r, i) => (
                <div key={`rev-${i}`} className={styles.finding} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span className={styles.entityAttr}>{r.entity} · {r.attribute}</span>
                  {r.isCanon && <span className={styles.category}>canon</span>}
                  <span className={styles.locChapter}>{r.chapters.join(', ')}</span>
                </div>
              ))}
              {report.reverseIndex.length > 50 && (
                <p className={styles.dim}>Showing the 50 most-referenced facts of {report.reverseIndex.length}.</p>
              )}
            </div>
          )}
        </>
      )}

      {!report && !running && !progress && slug && !unavailable && !err && (
        <p className={styles.dim}>No report yet — run an audit to scan this book.</p>
      )}
    </div>
  );
}
