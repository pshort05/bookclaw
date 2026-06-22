import { useEffect, useState } from 'react';
import type { AppendixEntry, WorldDocCatalogRow } from '@bookclaw/shared';
import { listWorldDocs, saveAppendix } from '../../lib/worldApi.js';
import styles from './BookPanels.module.css';

/** Pick appendix-eligible docs + order them; save the ordered selection. */
export function AppendixPanel({ slug, worldName, current, onSaved }: {
  slug: string; worldName: string; current?: AppendixEntry[]; onSaved?: (entries: AppendixEntry[]) => void;
}) {
  const [pool, setPool] = useState<WorldDocCatalogRow[]>([]);
  const [entries, setEntries] = useState<AppendixEntry[]>(current ?? []);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null);
    listWorldDocs(worldName)
      .then((rows) => setPool(rows.filter((r) => r.appendixEligible)))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [worldName]);

  const titleOf = (docId: string) => pool.find((r) => r.docId === docId)?.title ?? docId;

  const inSel = (docId: string) => entries.some((e) => e.docId === docId);
  const add = (docId: string) => setEntries((xs) => xs.some((e) => e.docId === docId) ? xs : [...xs, { docId, order: xs.length }]);
  const remove = (docId: string) => setEntries((xs) => xs.filter((e) => e.docId !== docId));
  const move = (i: number, d: -1 | 1) => setEntries((xs) => {
    const j = i + d; if (j < 0 || j >= xs.length) return xs;
    const n = [...xs]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const setTitle = (i: number, title: string) => setEntries((xs) => xs.map((e, idx) => idx === i ? { ...e, title: title || undefined } : e));

  async function save() {
    if (saving) return;
    setSaving(true); setError(null); setMsg(null);
    try {
      const out = entries.map((e, i) => ({ ...e, order: i }));
      await saveAppendix(slug, out);
      setMsg(`Saved ${out.length} appendix entr${out.length === 1 ? 'y' : 'ies'}.`);
      onSaved?.(out);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.phead}>
        <div className={styles.ptitle}>Edit appendix</div>
        <div className={styles.pacts}>
          <button className={styles.btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save appendix'}</button>
        </div>
      </div>

      {error && <div className={styles.err}>{error}</div>}
      {msg && <div className={styles.ok}>{msg}</div>}
      {loading && <div className={styles.faint}>Loading eligible documents…</div>}

      {entries.length > 0 && (
        <div className={styles.list}>
          {entries.map((e, i) => (
            <div key={e.docId} className={styles.orow}>
              <span className={styles.onum}>{i + 1}</span>
              <span className={styles.rowmain}>
                <span className={styles.rowtitle}>{titleOf(e.docId)}</span>
                <input
                  className={styles.tinput}
                  value={e.title ?? ''}
                  placeholder="title override (optional)"
                  onChange={(ev) => setTitle(i, ev.target.value)}
                />
              </span>
              <span className={styles.octrl}>
                <button onClick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</button>
                <button onClick={() => move(i, 1)} disabled={i === entries.length - 1} title="Move down">↓</button>
                <button onClick={() => remove(e.docId)} title="Remove">×</button>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.poollabel}>Eligible documents</div>
      {!loading && pool.length === 0 && <div className={styles.faint}>No appendix-eligible documents in this world.</div>}
      <div className={styles.list}>
        {pool.map((r) => (
          <label key={r.docId} className={styles.row}>
            <input type="checkbox" checked={inSel(r.docId)} onChange={() => inSel(r.docId) ? remove(r.docId) : add(r.docId)} />
            <span className={styles.rowmain}>
              <span className={styles.rowtitle}>{r.title}</span>
              {r.summary && <span className={styles.rowmeta}>{r.summary}</span>}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
