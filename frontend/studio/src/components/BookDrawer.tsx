import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useStore, useActiveBook, useCosts, money, LIFECYCLE_PHASES, type BookDetail, type NextStep } from '@bookclaw/shared';
import { Button } from '@bookclaw/shared';
import { BuildBiblePanel } from './book/BuildBiblePanel.js';
import { AppendixPanel } from './book/AppendixPanel.js';
import { WorldBindControl } from './book/WorldBindControl.js';
import styles from './BookDrawer.module.css';

export function BookDrawer({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [data, setData] = useState<BookDetail | null>(null);
  const [next, setNext] = useState<NextStep | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [panel, setPanel] = useState<'bible' | 'appendix' | null>(null);
  const activeBook = useActiveBook();
  const costs = useCosts();
  const loadBooks = useStore((s) => s.loadBooks);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    setData(null); setNext(null); setError(null); setPanel(null);
    api<BookDetail>(`/api/books/${encodeURIComponent(slug)}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    api<{ next: NextStep | null }>(`/api/books/${encodeURIComponent(slug)}/next`)
      .then((r) => { if (!cancelled) setNext(r.next); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [slug]);

  // Re-fetch the book after a World panel saves so counts/refs reflect the change.
  const refreshBook = () => {
    api<BookDetail>(`/api/books/${encodeURIComponent(slug)}`).then(setData).catch(() => {});
  };

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
  // The book's pipeline-derived phase segments (N); fall back to the lifecycle list.
  const phases: readonly string[] = data?.phases?.length ? data.phases : LIFECYCLE_PHASES;
  const curIdx = data ? phases.indexOf(data.book.phase) : -1;
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
              {/* Assets with optional per-asset descriptions */}
              <div className={styles.assets}>
                <div className={styles.asset}>
                  <div className={styles.l}>Author</div>
                  <div className={styles.v}>{pf?.author?.name ?? '—'}</div>
                  {data.descriptions?.author && <div className={styles.adesc}>{data.descriptions.author}</div>}
                </div>
                <div className={styles.asset}>
                  <div className={styles.l}>Voice</div>
                  <div className={`${styles.v} ${styles.it}`}>{pf?.voice?.name ?? '—'}</div>
                  {data.descriptions?.voice && <div className={styles.adesc}>{data.descriptions.voice}</div>}
                </div>
                <div className={styles.asset}>
                  <div className={styles.l}>Genre</div>
                  <div className={`${styles.v} ${styles.it}`}>{pf?.genre?.name ?? '—'}</div>
                  {data.descriptions?.genre && <div className={styles.adesc}>{data.descriptions.genre}</div>}
                </div>
                <div className={styles.asset}>
                  <div className={styles.l}>World</div>
                  <div className={styles.v}>{pf?.world?.name ?? '—'}</div>
                </div>
                <div className={styles.asset}>
                  <div className={styles.l}>Pipeline</div>
                  <div className={styles.v}>{pf?.pipeline?.name ?? '—'}</div>
                </div>
                <div className={styles.asset}>
                  <div className={styles.l}>Spend</div>
                  <div className={styles.v}>{money(costs?.byBook?.[slug] ?? 0)}</div>
                </div>
              </div>

              {/* World bind / change / unbind control — visible regardless of current binding */}
              <div className={styles.sec}>World</div>
              <WorldBindControl
                slug={slug}
                boundWorld={pf?.world?.name}
                seriesId={pf?.series?.id}
                onChanged={refreshBook}
              />

              {/* World repository panels — only when the book is bound to a world */}
              {pf?.world?.name && (
                <>
                  <div className={styles.sec}>World repository</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                    <Button variant={panel === 'bible' ? 'primary' : 'secondary'} onClick={() => setPanel(panel === 'bible' ? null : 'bible')}>
                      Build bible from world
                    </Button>
                    <Button variant={panel === 'appendix' ? 'primary' : 'secondary'} onClick={() => setPanel(panel === 'appendix' ? null : 'appendix')}>
                      Edit appendix
                    </Button>
                  </div>
                  {panel === 'bible' && (
                    <BuildBiblePanel
                      slug={slug}
                      world={pf?.world?.name ?? ''}
                      current={data.book.worldDocs}
                      onSaved={refreshBook}
                      onClose={() => setPanel(null)}
                    />
                  )}
                  {panel === 'appendix' && (
                    <AppendixPanel
                      slug={slug}
                      worldName={pf.world.name}
                      current={data.book.appendix}
                      onSaved={refreshBook}
                    />
                  )}
                </>
              )}

              {/* Suggested next step */}
              {next && (
                <>
                  <div className={styles.sec}>Next step</div>
                  <div className={styles.nextstep}>
                    <b>{next.label}</b>
                    <div className={styles.nexthint}>{next.hint}</div>
                  </div>
                </>
              )}

              {/* Phase timeline — honest position derived from manifest.phase */}
              <div className={styles.sec}>Phase</div>
              <div className={styles.tline}>
                {phases.map((p, i) => {
                  const cls = i < curIdx ? styles.done : i === curIdx ? styles.cur : '';
                  return (
                    <div key={p} className={`${styles.tstep} ${cls}`}>
                      <div className={styles.stem}><div className={styles.nub} />{i < phases.length - 1 && <div className={styles.ln} />}</div>
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
          <Button variant="primary" onClick={() => { onClose(); navigate(`/write/${slug}`); }}>Open in Write</Button>
        </div>
      </aside>
    </>
  );
}
