import { useEffect, useState, useCallback } from 'react';
import { api, apiBase, authToken, useStore, useActiveBook } from '@bookclaw/shared';
import {
  runTryFailAudit,
  getTryFailReport,
  TRYFAIL_PROVIDERS,
  PROVIDER_DEFAULT_MODEL,
  type ProtagonistLadder,
  type TryFailFinding,
  type CrucibleAssessment,
  type TryFailReport,
  type FindingSeverity,
} from '../lib/tryFailApi.js';
import { useModelCatalog, CATALOG_PROVIDERS } from '../lib/openrouterModels.js';
import styles from './TryFail.module.css';

const SEVERITY_ORDER: FindingSeverity[] = ['high', 'medium', 'low'];

interface ReportEntry { id: string; kind: string; formats: string[]; }

// Build the native-download URL for the newest report of `kind`, or null if
// none exists yet. Carries the auth token via the ?token= query fallback.
function latestReportDownloadUrl(reports: ReportEntry[], slug: string, kind: string): string | null {
  const latest = reports.find((r) => r.kind === kind && r.formats.includes('md'));
  if (!latest) return null;
  const t = authToken();
  const base = `${apiBase()}/api/books/${encodeURIComponent(slug)}/reports/${encodeURIComponent(latest.id)}?format=md&download=1`;
  return t ? `${base}&token=${encodeURIComponent(t)}` : base;
}

function FindingCard({ finding }: { finding: TryFailFinding }) {
  const tagClass =
    finding.severity === 'high' ? styles.tagHigh :
    finding.severity === 'medium' ? styles.tagMedium :
    styles.tagLow;
  const where =
    finding.protagonist && finding.chapter ? `${finding.protagonist} · ch.${finding.chapter}` :
    finding.protagonist ? finding.protagonist :
    finding.chapter ? `ch.${finding.chapter}` : '';

  return (
    <div className={styles.finding}>
      <div className={styles.findingHead}>
        <span className={`${styles.tag} ${tagClass}`}>{finding.severity}</span>
        <span className={styles.category}>{finding.category}</span>
        {where && <span className={styles.findingMeta}>{where}</span>}
      </div>
      <div className={styles.detail}>{finding.detail}</div>
    </div>
  );
}

function Ladder({ ladder }: { ladder: ProtagonistLadder }) {
  return (
    <div className={styles.ladder}>
      <div className={styles.ladderHead}>
        <span className={styles.ladderName}>{ladder.protagonist}</span>
        <span className={`${styles.badge} ${ladder.deepens ? styles.badgeOn : styles.badgeOff}`}>
          {ladder.deepens ? '↑ deepens' : 'flat stakes'}
        </span>
        <span className={`${styles.badge} ${ladder.broadens ? styles.badgeOn : styles.badgeOff}`}>
          {ladder.broadens ? '↔ broadens' : 'flat reach'}
        </span>
      </div>
      {ladder.attempts.length === 0 ? (
        <p className={styles.dim}>No discrete attempts detected.</p>
      ) : (
        <table className={styles.ladderTable}>
          <thead>
            <tr>
              <th>Ch.</th>
              <th>Goal</th>
              <th>Conflict</th>
              <th>Outcome</th>
              <th>Cost</th>
              <th>Stakes</th>
              <th>Affected</th>
            </tr>
          </thead>
          <tbody>
            {ladder.attempts.map((a, i) => (
              <tr key={i}>
                <td>{a.chapter}</td>
                <td>{a.goal}</td>
                <td>{a.conflict}</td>
                <td>{a.outcome}</td>
                <td>{a.cost}</td>
                <td>{a.personalStakes}</td>
                <td>{a.peopleAffected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Crucible({ crucible }: { crucible: CrucibleAssessment }) {
  return (
    <div className={styles.crucible}>
      <div className={styles.crucibleHead}>
        <span className={styles.crucibleVerdict}>
          {crucible.present
            ? `Crucible present — strongest binding force: ${crucible.strongest}`
            : 'No crucible detected — characters could simply walk away.'}
        </span>
      </div>
      {crucible.signals.map((s, i) => (
        <div key={i} className={styles.signal}>
          {s.kind} ({s.strength}, ch.{s.chapter}): {s.description}
        </div>
      ))}
    </div>
  );
}

export function TryFail() {
  const loadBooks = useStore((s) => s.loadBooks);
  const books = useStore((s) => s.books);
  const activeBook = useActiveBook();

  const [slug, setSlug] = useState('');
  useEffect(() => {
    if (!slug && books.length) setSlug(activeBook?.slug ?? books[0].slug);
  }, [books, activeBook, slug]);

  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<TryFailReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reportDownload, setReportDownload] = useState<string | null>(null);
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  // Model catalog for the exact-model picker (lazy-fetched for providers with a
  // catalog proxy; gateway-cached). Fail-soft to free-text.
  const catalogModels = useModelCatalog(provider);

  useEffect(() => { loadBooks().catch(() => {}); }, [loadBooks]);

  // Latest downloadable try-fail report (hidden when none exists yet). Refreshed
  // on book change and after a run — NOT keyed on `report`, which would double-fetch
  // the reports list on the mount (null → loaded) transition.
  const refreshDownload = useCallback(() => {
    if (!slug) { setReportDownload(null); return; }
    api<{ reports: ReportEntry[] }>(`/api/books/${encodeURIComponent(slug)}/reports`)
      .then((r) => setReportDownload(latestReportDownloadUrl(r.reports ?? [], slug, 'try-fail')))
      .catch(() => setReportDownload(null));
  }, [slug]);
  useEffect(() => { refreshDownload(); }, [refreshDownload]);

  // Load any existing report when the book changes.
  const loadReport = useCallback(() => {
    if (!slug) return;
    setReport(null);
    setErr(null);
    getTryFailReport(slug)
      .then(({ report }) => setReport(report))
      .catch((e: Error) => setErr(`Failed to load report — ${String(e)}`));
  }, [slug]);

  useEffect(() => { loadReport(); }, [loadReport]);

  async function runAudit() {
    if (!slug || running) return;
    setRunning(true);
    setErr(null);
    try {
      const r = await runTryFailAudit(slug, { provider: provider || undefined, model: model || undefined });
      setReport(r);
      refreshDownload();
    } catch (e: unknown) {
      setErr(`Audit failed — ${String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  // Group findings by severity.
  const grouped: Record<FindingSeverity, TryFailFinding[]> = { high: [], medium: [], low: [] };
  if (report) {
    for (const f of report.findings) grouped[f.severity].push(f);
  }

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Try-Fail & Escalation Auditor</h1>
      <p className={styles.sub}>
        {books.length
          ? <>Audit each protagonist's try-fail ladder: do early attempts genuinely fail, do conflicts deepen and broaden, and is there a crucible that stops characters walking away?</>
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
            onChange={(e) => { setProvider(e.target.value); if (!e.target.value) setModel(''); }}
            disabled={running}
          >
            <option value="">default (auto)</option>
            {TRYFAIL_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {provider !== '' && (
          <div className={styles.field}>
            <span className={styles.fl}>Exact model</span>
            <input
              className={styles.pick}
              type="text"
              list={CATALOG_PROVIDERS.has(provider) ? 'tryfail-models' : undefined}
              value={model}
              placeholder={PROVIDER_DEFAULT_MODEL[provider]}
              onChange={(e) => setModel(e.target.value)}
              disabled={running}
            />
            {CATALOG_PROVIDERS.has(provider) && (
              <datalist id="tryfail-models">
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
          {running ? 'Running…' : 'Run Try-Fail Audit'}
        </button>

        {reportDownload && (
          <a className={styles.dim} href={reportDownload} style={{ textDecoration: 'underline' }}>
            Download latest report
          </a>
        )}
      </div>

      {running && <p className={styles.progress}>Auditing the manuscript…</p>}

      {report && !running && (
        <>
          <p className={styles.reportMeta}>
            {report.protagonists.length} {report.protagonists.length === 1 ? 'protagonist' : 'protagonists'}
            {' · '}{report.findings.length} {report.findings.length === 1 ? 'finding' : 'findings'}
            {report.condensed ? ' · condensed' : ''}
            {' · '}{new Date(report.generatedAt).toLocaleString()}
          </p>

          {report.summary && <p className={styles.summary}>{report.summary}</p>}

          <Crucible crucible={report.crucible} />

          {report.protagonists.length > 0 && (
            <div className={styles.group}>
              <div className={styles.groupHeader}>Protagonist ladders</div>
              {report.protagonists.map((l) => <Ladder key={l.protagonist} ladder={l} />)}
            </div>
          )}

          {report.findings.length === 0 ? (
            <p className={styles.empty}>No try-fail or escalation issues detected.</p>
          ) : (
            SEVERITY_ORDER.map((sev) => {
              const findings = grouped[sev];
              if (findings.length === 0) return null;
              return (
                <div key={sev} className={styles.group}>
                  <div className={styles.groupHeader}>{sev} severity</div>
                  {findings.map((f, i) => <FindingCard key={`${sev}-${i}`} finding={f} />)}
                </div>
              );
            })
          )}
        </>
      )}

      {!report && !running && slug && !err && (
        <p className={styles.dim}>No report yet — run an audit to analyze this book.</p>
      )}
    </div>
  );
}
