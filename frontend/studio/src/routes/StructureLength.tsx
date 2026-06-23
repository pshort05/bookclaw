import { useEffect, useState, useCallback } from 'react';
import { useActiveBook } from '@bookclaw/shared';
import {
  getStructureReview, proposeStructure, saveStructureReview, getLengthReview,
  type StructureReview, type LengthReview,
} from '../lib/formatReviewApi.js';

const statusColor = (s: string) => s === 'found_in_range' ? 'var(--ok, #2a8)' : s === 'found_misplaced' ? '#c80' : 'var(--alert)';

export function StructureLength() {
  const activeBook = useActiveBook();
  const slug = activeBook?.slug ?? '';
  const [sr, setSr] = useState<StructureReview | null>(null);
  const [lr, setLr] = useState<LengthReview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!slug) return;
    setErr(null);
    getStructureReview(slug).then(setSr).catch((e) => { setSr(null); setErr(String(e)); });
    getLengthReview(slug).then(setLr).catch(() => setLr(null));
  }, [slug]);

  useEffect(() => { load(); }, [load]);

  const propose = async () => {
    if (!slug) return;
    setBusy(true);
    try {
      const { mapping } = await proposeStructure(slug);
      const next = { outline: sr?.outline ?? [], mapping };
      await saveStructureReview(slug, next);
      load();
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  if (!slug) return <div style={{ padding: 24 }}>Select a book to review its structure and length.</div>;

  const notConfigured = sr?.configured === false || lr?.configured === false;
  if (notConfigured) {
    return (
      <div style={{ padding: 24, maxWidth: 920 }}>
        <h1>Structure &amp; Length</h1>
        <p style={{ opacity: 0.8 }}>
          <strong>{activeBook?.title ?? 'This book'}</strong> has no declared format yet. Choose a Structure and Form
          (with chapter count and words-per-chapter) when creating a book to enable this review.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 920 }}>
      <h1>Structure &amp; Length</h1>
      {err && <p style={{ color: 'var(--alert)' }}>{err}</p>}

      <section style={{ marginTop: 24 }}>
        <h2>Structure {sr?.structure ? `· ${sr.structure.name}` : ''}</h2>
        <button onClick={propose} disabled={busy || !sr?.structure}>{busy ? 'Proposing…' : 'Propose beat mapping (AI)'}</button>
        {sr?.report && (
          <>
            <p>{sr.report.summary}</p>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
              <thead><tr><th align="left">Beat</th><th align="left">Expected</th><th align="left">Found</th><th align="left">Status</th></tr></thead>
              <tbody>
                {sr.report.results.map((r) => (
                  <tr key={r.beat.name} style={{ borderTop: '1px solid var(--border, #333)' }}>
                    <td>{r.beat.name}{r.beat.mustHave ? ' *' : ''}</td>
                    <td>{r.beat.expectedPct}% ({r.beat.pctRange[0]}–{r.beat.pctRange[1]})</td>
                    <td>{r.foundAtPct == null ? '—' : `${r.foundAtPct}%`}</td>
                    <td style={{ color: statusColor(r.status) }}>{r.status.replace(/_/g, ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>Length</h2>
        {lr ? (
          <>
            <p>
              Total: {lr.totalWords.toLocaleString()} / target {lr.totalTarget.toLocaleString()} words —{' '}
              <span style={{ color: lr.withinBand ? 'var(--ok, #2a8)' : 'var(--alert)' }}>{lr.withinBand ? 'within band ✓' : (lr.bandMessage || 'out of band')}</span>
              {lr.genreRange && <> · genre norm {lr.genreRange[0].toLocaleString()}–{lr.genreRange[1].toLocaleString()}</>}
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th align="left">Chapter</th><th align="right">Words</th><th align="right">Target</th><th align="right">Δ</th></tr></thead>
              <tbody>
                {lr.perChapter.map((c) => (
                  <tr key={c.chapter} style={{ borderTop: '1px solid var(--border, #333)' }}>
                    <td>{c.chapter}</td>
                    <td align="right">{c.words.toLocaleString()}</td>
                    <td align="right">{c.target.toLocaleString()}</td>
                    <td align="right" style={{ color: Math.abs(c.delta) > c.target * 0.25 ? 'var(--alert)' : 'inherit' }}>{c.delta > 0 ? '+' : ''}{c.delta.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : <p>No length data yet.</p>}
      </section>
    </div>
  );
}
