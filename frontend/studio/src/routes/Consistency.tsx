import { useEffect, useState, useCallback } from 'react';
import { api, apiBase, authToken, useStore, useActiveBook } from '@bookclaw/shared';
import {
  runConsistencyAudit,
  getConsistencyReport,
  saveConsistencyModel,
  subscribeConsistency,
  CONSISTENCY_PROVIDERS,
  PROVIDER_DEFAULT_MODEL,
  type ConsistencyFinding,
  type ConsistencyReport,
  type Severity,
} from '../lib/consistencyApi.js';
import { useModelCatalog, CATALOG_PROVIDERS } from '../lib/openrouterModels.js';
import styles from './Consistency.module.css';

const SEVERITY_ORDER: Severity[] = ['high', 'medium', 'low'];

interface ReportEntry { id: string; kind: string; formats: string[]; }

// Build the native-download URL for the newest report of `kind`, or null if none
// exists yet. Carries the auth token via the ?token= query fallback.
function latestReportDownloadUrl(reports: ReportEntry[], slug: string, kind: string): string | null {
  const latest = reports.find((r) => r.kind === kind && r.formats.includes('md'));
  if (!latest) return null;
  const t = authToken();
  const base = `${apiBase()}/api/books/${encodeURIComponent(slug)}/reports/${encodeURIComponent(latest.id)}?format=md&download=1`;
  return t ? `${base}&token=${encodeURIComponent(t)}` : base;
}

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
  const [reportDownload, setReportDownload] = useState<string | null>(null);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  // Model catalog for the exact-model picker (lazy-fetched for providers with a
  // catalog proxy; gateway-cached). Fail-soft to free-text.
  const catalogModels = useModelCatalog(provider);

  useEffect(() => { loadBooks().catch(() => {}); }, [loadBooks]);

  // Latest downloadable consistency report (hidden when none exists yet).
  useEffect(() => {
    if (!slug) { setReportDownload(null); return; }
    api<{ reports: ReportEntry[] }>(`/api/books/${encodeURIComponent(slug)}/reports`)
      .then((r) => setReportDownload(latestReportDownloadUrl(r.reports ?? [], slug, 'consistency')))
      .catch(() => setReportDownload(null));
  }, [slug, report]);

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
      .then(({ report, running, job, consistencyModel }) => {
        setReport(report);
        setProvider(consistencyModel?.provider ?? '');
        setModel(consistencyModel?.model ?? '');
        // Rehydrate an audit that is still running on the server (e.g. after a
        // reconnect): restore the running UI and resubscribe via the live socket
        // subscription (already active for this component) for progress/complete.
        if (running) {
          setRunning(true);
          setProgress(job?.lastMessage ?? 'Audit in progress…');
        }
      })
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
      await runConsistencyAudit(slug, { provider: provider || undefined, model: model || undefined });
      // Progress and completion arrive via socket events.
    } catch (e: unknown) {
      const err = e as Error & { status?: number };
      if (err.status === 503) {
        setUnavailable(true);
        setRunning(false);
        setProgress(null);
      } else if (err.status === 409) {
        // An audit is already running for this book (e.g. started in another
        // tab, or this one reconnected) — keep the running UI, don't error.
        setRunning(true);
        setProgress('Audit already running…');
      } else {
        setErr(`Failed to start audit — ${String(e)}`);
        setRunning(false);
        setProgress(null);
      }
    }
  }

  // Persist the per-book model choice (fire-and-forget; never block the UI).
  function persistModel(nextProvider: string, nextModel: string) {
    if (!slug) return;
    saveConsistencyModel(slug, {
      provider: nextProvider || undefined,
      model: nextModel || undefined,
    }).catch(() => {});
  }

  function onProviderChange(next: string) {
    setProvider(next);
    // Clearing the provider (auto) also clears any model override.
    const nextModel = next ? model : '';
    if (!next) setModel('');
    persistModel(next, nextModel);
  }

  // Update local state on each keystroke, but only persist on blur — otherwise
  // every character fires a PUT (a book.json read + rewrite + history entry).
  function onModelChange(next: string) {
    setModel(next);
  }
  function onModelBlur() {
    persistModel(provider, model);
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

        <div className={styles.field}>
          <span className={styles.fl}>Model</span>
          <select
            className={styles.pick}
            value={provider}
            onChange={(e) => onProviderChange(e.target.value)}
            disabled={running}
          >
            <option value="">default (auto)</option>
            {CONSISTENCY_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {provider !== '' && (
          <div className={styles.field}>
            <span className={styles.fl}>Exact model</span>
            <input
              className={styles.pick}
              type="text"
              list={CATALOG_PROVIDERS.has(provider) ? 'openrouter-models' : undefined}
              value={model}
              placeholder={PROVIDER_DEFAULT_MODEL[provider]}
              onChange={(e) => onModelChange(e.target.value)}
              onBlur={onModelBlur}
              disabled={running}
            />
            {CATALOG_PROVIDERS.has(provider) && (
              <datalist id="openrouter-models">
                {catalogModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </datalist>
            )}
          </div>
        )}

        <button
          className={styles.runBtn}
          onClick={runAudit}
          disabled={!slug || running}
        >
          {running ? 'Running…' : 'Run audit'}
        </button>

        {reportDownload && (
          <a className={styles.dim} href={reportDownload} style={{ textDecoration: 'underline' }}>
            Download latest report
          </a>
        )}
      </div>

      {progress && <p className={styles.progress}>{progress}</p>}

      {report && !running && (
        <>
          <p className={styles.reportMeta}>
            {report.chaptersScanned}{report.chaptersTotal ? ` of ${report.chaptersTotal}` : ''} {report.chaptersScanned === 1 ? 'chapter' : 'chapters'} scanned
            {' · '}{report.factCount} facts
            {report.estimatedCost && report.estimatedCost > 0 ? <>{' · '}~${report.estimatedCost.toFixed(4)} (est.)</> : null}
            {' · '}{new Date(report.generatedAt).toLocaleString()}
          </p>

          {report.chaptersFailed ? (
            <div className={styles.err}>
              <p>
                ⚠ {report.aborted ? 'Scan aborted' : 'Incomplete scan'} — {report.chaptersFailed} chapter{report.chaptersFailed === 1 ? '' : 's'} failed extraction and {report.chaptersFailed === 1 ? 'was' : 'were'} skipped.
                {' '}Findings below are NOT a clean bill of health.
              </p>
              {report.failureSamples && report.failureSamples.length > 0 && (
                <ul>
                  {report.failureSamples.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              )}
            </div>
          ) : null}

          {report.chapterSummary && report.chapterSummary.length > 0 && (
            <details className={styles.summaryWrap} open>
              <summary>Chapter summary ({report.chapterSummary.length})</summary>
              <table className={styles.summaryTable}>
                <thead>
                  <tr>
                    <th>Chapter</th><th>Scan</th><th>High</th><th>Medium</th><th>Low</th><th>Items tracked</th>
                  </tr>
                </thead>
                <tbody>
                  {report.chapterSummary.map((r) => (
                    <tr key={r.chapter}>
                      <td>{r.chapter}</td>
                      <td>{r.status === 'scanned' ? '✓ scanned' : r.status === 'failed' ? '✗ failed' : '— skipped'}</td>
                      <td>{r.high}</td>
                      <td>{r.medium}</td>
                      <td>{r.low}</td>
                      <td>{r.itemsTracked}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          {report.findings.length === 0 ? (
            <p className={styles.empty}>
              {report.chaptersScanned === 0
                ? 'No chapters were analyzed — check the model selection and that the book has manuscript text.'
                : report.chaptersFailed
                  ? 'No inconsistencies in the chapters that were scanned (some chapters failed — see above).'
                  : 'No findings — no inconsistencies detected.'}
            </p>
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
