import { useEffect, useState, useCallback } from 'react';
import { api, apiBase, authToken, useStore, useActiveBook } from '@bookclaw/shared';
import {
  runConsistencyAudit,
  getConsistencyReport,
  saveConsistencyModel,
  subscribeConsistency,
  proposeConsistencyFixes,
  applyConsistencyFixes,
  CONSISTENCY_PROVIDERS,
  PROVIDER_DEFAULT_MODEL,
  FIXABLE_CATEGORIES,
  type ConsistencyFinding,
  type ConsistencyReport,
  type ProposedEdit,
  type ConfirmedEdit,
  type ApplyOutcome,
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

function FindingCard({
  finding,
  fixSelected,
  onToggleFix,
  toggleDisabled,
}: {
  finding: ConsistencyFinding;
  fixSelected: boolean;
  onToggleFix: (next: boolean) => void;
  toggleDisabled: boolean;
}) {
  const tagClass =
    finding.severity === 'high' ? styles.tagHigh :
    finding.severity === 'medium' ? styles.tagMedium :
    styles.tagLow;
  const isFixableCat = FIXABLE_CATEGORIES.has(finding.category);
  // A fixable category only gets a working toggle when the finding carries a
  // stable id — older reports (audited before this feature) lack ids, so the
  // propose round-trip can't reference them; prompt a re-audit instead.
  const fixable = isFixableCat && !!finding.id;

  return (
    <div className={styles.finding}>
      <div className={styles.findingHead}>
        <span className={`${styles.tag} ${tagClass}`}>{finding.severity}</span>
        <span className={styles.entityAttr}>{finding.entity} · {finding.attribute}</span>
        <span className={styles.category}>{finding.category}</span>
        {fixable ? (
          <div className={styles.fixToggle}>
            <button
              type="button"
              className={`${styles.fixToggleBtn} ${!fixSelected ? styles.fixToggleActive : ''}`}
              onClick={() => onToggleFix(false)}
              disabled={toggleDisabled}
            >
              Ignore
            </button>
            <button
              type="button"
              className={`${styles.fixToggleBtn} ${fixSelected ? styles.fixToggleActive : ''}`}
              onClick={() => onToggleFix(true)}
              disabled={toggleDisabled}
            >
              Fix
            </button>
          </div>
        ) : isFixableCat ? (
          <span className={styles.manualBadge}>re-run audit to enable fixes</span>
        ) : (
          <span className={styles.manualBadge}>manual — needs a plot change</span>
        )}
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

  // Apply-fix flow: which findings are toggled to Fix, the proposed preview, and
  // the apply lifecycle. All keyed by the finding's stable id.
  const [fixSelected, setFixSelected] = useState<Set<string>>(new Set());
  const [proposals, setProposals] = useState<ProposedEdit[] | null>(null);
  const [proposing, setProposing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyOutcome | null>(null);
  const [fixErr, setFixErr] = useState<string | null>(null);

  // Reset the whole fix flow whenever the report changes (new book or re-audit).
  useEffect(() => {
    setFixSelected(new Set());
    setProposals(null);
    setApplyResult(null);
    setFixErr(null);
  }, [report]);

  function toggleFix(id: string, next: boolean) {
    setFixSelected((prev) => {
      const out = new Set(prev);
      if (next) out.add(id); else out.delete(id);
      return out;
    });
  }

  async function prepareFixes() {
    if (!slug || fixSelected.size === 0 || proposing) return;
    setProposing(true);
    setFixErr(null);
    setApplyResult(null);
    try {
      const { proposals } = await proposeConsistencyFixes(slug, [...fixSelected], {
        provider: provider || undefined,
        model: model || undefined,
      });
      setProposals(proposals);
    } catch (e: unknown) {
      setFixErr(`Failed to prepare fixes — ${String(e)}`);
    } finally {
      setProposing(false);
    }
  }

  async function confirmApply() {
    if (!slug || !proposals || applying) return;
    const edits: ConfirmedEdit[] = proposals
      .filter((p) => p.anchored)
      .map((p) => ({
        findingId: p.findingId,
        targetChapter: p.targetChapter,
        oldPhrase: p.oldPhrase,
        newPhrase: p.newPhrase,
      }));
    if (edits.length === 0) return;
    setApplying(true);
    setFixErr(null);
    try {
      const outcome = await applyConsistencyFixes(slug, edits);
      setApplyResult(outcome);
      setProposals(null);
      setFixSelected(new Set());
    } catch (e: unknown) {
      setFixErr(`Failed to apply fixes — ${String(e)}`);
    } finally {
      setApplying(false);
    }
  }

  function cancelFixes() {
    setProposals(null);
    setFixErr(null);
  }

  useEffect(() => { loadBooks().catch(() => {}); }, [loadBooks]);

  // Latest downloadable consistency report (hidden when none exists yet).
  useEffect(() => {
    if (!slug) { setReportDownload(null); return; }
    api<{ reports: ReportEntry[] }>(`/api/books/${encodeURIComponent(slug)}/reports`)
      .then((r) => setReportDownload(latestReportDownloadUrl(r.reports ?? [], slug, 'consistency')))
      .catch(() => setReportDownload(null));
  }, [slug, report]);

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

  // Subscribe to socket events for the duration of the component's life.
  // onReconnect refetches state (via loadReport) so an audit that completed
  // while the socket was dropped — whose one-shot 'consistency-complete' event
  // was missed — no longer strands the UI on 'Running…'.
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
      onReconnect: loadReport,
    });
  }, [slug, loadReport]);

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
                      <FindingCard
                        key={f.id || `${cat}-${i}`}
                        finding={f}
                        fixSelected={fixSelected.has(f.id)}
                        onToggleFix={(next) => toggleFix(f.id, next)}
                        toggleDisabled={proposing || applying || !!proposals}
                      />
                    ))
                  )}
                </div>
              );
            })
          )}

          {report.findings.length > 0 && (
            <div className={styles.fixFlow}>
              {fixErr && <p className={styles.err}>{fixErr}</p>}

              {!proposals && !applyResult && (
                <button
                  className={styles.runBtn}
                  onClick={prepareFixes}
                  disabled={fixSelected.size === 0 || proposing}
                >
                  {proposing
                    ? 'Preparing…'
                    : `Prepare fixes${fixSelected.size ? ` (${fixSelected.size})` : ''}`}
                </button>
              )}

              {proposals && (
                <div className={styles.preview}>
                  <div className={styles.groupHeader}>Proposed fixes ({proposals.length})</div>
                  {proposals.map((p) => (
                    <div
                      key={p.findingId}
                      className={`${styles.proposal} ${p.anchored ? '' : styles.proposalSkipped}`}
                    >
                      <div className={styles.proposalHead}>
                        <span className={styles.entityAttr}>{p.entity} · {p.attribute}</span>
                        <span className={styles.category}>{p.targetChapter}</span>
                        {!p.anchored && (
                          <span className={styles.skipTag}>couldn't anchor — will be skipped</span>
                        )}
                      </div>
                      <div className={styles.diff}>
                        <span className={styles.diffOld}>{p.oldPhrase}</span>
                        <span className={styles.diffArrow}>→</span>
                        <span className={styles.diffNew}>{p.newPhrase}</span>
                      </div>
                      {p.note && <div className={styles.proposalNote}>{p.note}</div>}
                    </div>
                  ))}

                  <div className={styles.fixActions}>
                    <button
                      className={styles.runBtn}
                      onClick={confirmApply}
                      disabled={applying || proposals.every((p) => !p.anchored)}
                    >
                      {applying
                        ? 'Applying…'
                        : `Confirm & apply (${proposals.filter((p) => p.anchored).length})`}
                    </button>
                    <button
                      className={styles.cancelBtn}
                      onClick={cancelFixes}
                      disabled={applying}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {applyResult && (
                <div className={styles.applySummary}>
                  <p className={styles.applySummaryHead}>
                    ✓ Applied {applyResult.applied.length} fix{applyResult.applied.length === 1 ? '' : 'es'}
                    {' across '}{applyResult.chaptersWritten.length} chapter{applyResult.chaptersWritten.length === 1 ? '' : 's'}.
                  </p>
                  {applyResult.skipped.length > 0 && (
                    <ul className={styles.skippedList}>
                      {applyResult.skipped.map((s, i) => (
                        <li key={`${s.findingId}-${i}`}>
                          Skipped “{s.oldPhrase}” — {s.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className={styles.dim}>Click <strong>Run audit</strong> above to re-run the audit and verify.</p>
                </div>
              )}
            </div>
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
