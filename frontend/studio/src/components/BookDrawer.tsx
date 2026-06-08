import { useEffect, useState } from 'react';
import { api, useStore, useActiveBook, type BookManifest, type BookStatus } from '@bookclaw/shared';
import { Button } from '@bookclaw/shared';
import styles from './BookDrawer.module.css';

const PHASES = ['planning', 'bible', 'production', 'revision', 'format', 'launch'] as const;

export function BookDrawer({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [data, setData] = useState<{ book: BookManifest; status: BookStatus } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const activeBook = useActiveBook();
  const loadBooks = useStore((s) => s.loadBooks);

  useEffect(() => {
    setData(null); setError(null);
    api<{ book: BookManifest; status: BookStatus }>(`/api/books/${encodeURIComponent(slug)}`)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [slug]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setActive = async () => {
    setActivating(true);
    try {
      await api('/api/books/active', { method: 'POST', body: JSON.stringify({ slug }) });
      await loadBooks();
    } catch (e) {
      setError(`Couldn't set active — ${String(e)}`);
    } finally { setActivating(false); }
  };

  const pf = data?.book.pulledFrom;
  const curIdx = data ? PHASES.indexOf(data.book.phase as typeof PHASES[number]) : -1;
  const isActive = activeBook?.slug === slug;

  return (
    <>
      <div className={`${styles.scrim} ${styles.on}`} onClick={onClose} />
      <aside className={`${styles.drawer} ${styles.on}`} role="dialog" aria-label="Book detail">
        <div className={styles.dhead}>
          <button className={styles.dclose} onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
          <h2>{data?.book.title ?? slug}</h2>
          {pf?.genre?.name && <div className={styles.genre}>{pf.genre.name}</div>}
        </div>

        <div className={styles.dbody}>
          {error ? (
            <p>Couldn't load this book — {error}</p>
          ) : !data ? (
            <p>Loading…</p>
          ) : (
            <>
              {/* Assets (names only; per-asset descriptions + canonical tooltips = 6e) */}
              <div className={styles.assets}>
                <div className={styles.asset}><div className={styles.l}>Author</div><div className={styles.v}>{pf?.author?.name ?? '—'}</div></div>
                <div className={styles.asset}><div className={styles.l}>Voice</div><div className={`${styles.v} ${styles.it}`}>{pf?.voice?.name ?? '—'}</div></div>
                <div className={styles.asset}><div className={styles.l}>Genre</div><div className={`${styles.v} ${styles.it}`}>{pf?.genre?.name ?? '—'}</div></div>
                <div className={styles.asset}><div className={styles.l}>Pipeline</div><div className={styles.v}>{pf?.pipeline?.name ?? '—'}</div></div>
              </div>

              {/* Phase timeline — honest position derived from manifest.phase */}
              <div className={styles.sec}>Phase</div>
              <div className={styles.tline}>
                {PHASES.map((p, i) => {
                  const cls = i < curIdx ? styles.done : i === curIdx ? styles.cur : '';
                  return (
                    <div key={p} className={`${styles.tstep} ${cls}`}>
                      <div className={styles.stem}><div className={styles.nub} />{i < PHASES.length - 1 && <div className={styles.ln} />}</div>
                      <div className={styles.tx}>
                        <b>{p}</b>
                        <div className={styles.meta}>{i < curIdx ? 'done' : i === curIdx ? 'current' : 'upcoming'}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className={styles.dfoot}>
          <Button variant="secondary" onClick={setActive} disabled={!data || isActive || activating}>
            {isActive ? 'Active book' : activating ? 'Activating…' : 'Set as active'}
          </Button>
          <Button variant="primary" disabled title="Write workspace — sub-phase 6d">Open in Write</Button>
        </div>
      </aside>
    </>
  );
}
