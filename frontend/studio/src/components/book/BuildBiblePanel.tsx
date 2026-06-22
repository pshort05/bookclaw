import { useCallback, useEffect, useState } from 'react';
import type { WorldProposal } from '@bookclaw/shared';
import { proposeWorldDocs, saveWorldDocs } from '../../lib/worldApi.js';
import styles from './BookPanels.module.css';

/** "Build bible from world" — propose relevant docs (AI-ranked), curate, save. */
export function BuildBiblePanel({ slug, current, onSaved, onClose }: {
  slug: string; current?: string[]; onSaved?: (docIds: string[]) => void; onClose?: () => void;
}) {
  const [proposals, setProposals] = useState<WorldProposal[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set(current ?? []));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null); setMsg(null);
    proposeWorldDocs(slug)
      .then((p) => setProposals(p))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setMsg(null);
    proposeWorldDocs(slug)
      .then((p) => { if (!cancelled) setProposals(p); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [slug]);

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function save() {
    if (saving) return;
    setSaving(true); setError(null); setMsg(null);
    try {
      await saveWorldDocs(slug, [...sel]);
      setMsg(`Saved ${sel.size} document${sel.size === 1 ? '' : 's'} as the bible.`);
      onSaved?.([...sel]);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.phead}>
        <div className={styles.ptitle}>Build bible from world</div>
        <div className={styles.pacts}>
          <button className={styles.btn} onClick={load} disabled={loading}>{loading ? 'Proposing…' : 'Re-propose'}</button>
          <button className={styles.btnPrimary} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save bible'}</button>
          {onClose && <button className={styles.btn} onClick={onClose}>Close</button>}
        </div>
      </div>

      {error && <div className={styles.err}>{error}</div>}
      {msg && <div className={styles.ok}>{msg}</div>}
      {loading && <div className={styles.faint}>Proposing relevant documents…</div>}
      {!loading && proposals.length === 0 && <div className={styles.faint}>No documents proposed.</div>}

      <div className={styles.list}>
        {proposals.map((p) => (
          <label key={p.docId} className={styles.row}>
            <input type="checkbox" checked={sel.has(p.docId)} onChange={() => toggle(p.docId)} />
            <span className={styles.rowmain}>
              <span className={styles.rowtitle}>{p.title}</span>
              <span className={styles.rowmeta}><span className={styles.pill}>rank {p.rank}</span> {p.reason}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
