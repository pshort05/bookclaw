import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useBooks } from '@bookclaw/shared';
import { BookDrawer } from '../components/BookDrawer.js';
import styles from './Board.module.css';

const PHASE_VAR: Record<string, string> = {
  planning: '--ph-plan', bible: '--ph-world', production: '--ph-prod',
  revision: '--ph-rev', format: '--ph-fmt', launch: '--ph-launch',
};

// Canonical pipeline phase order (manifest phase keys) — drives the 6-segment progress bar.
const PHASE_ORDER = ['planning', 'bible', 'production', 'revision', 'format', 'launch'];

export function Board() {
  const books = useBooks();
  const loadBooks = useStore((s) => s.loadBooks);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('All');
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => { loadBooks().catch((e) => setError(String(e))); }, [loadBooks]);

  // While any book is generating, the live "writing…" strip + Rail counts go stale
  // on a one-shot load — poll until nothing is live, clearing on unmount.
  const anyLive = books.some((b) => b.live);
  useEffect(() => {
    if (!anyLive) return;
    const id = setInterval(() => { loadBooks().catch(() => {}); }, 4000);
    return () => clearInterval(id);
  }, [anyLive, loadBooks]);

  // Filters: All + "Needs you" (gate status != ok) + one chip per distinct phase present.
  const chips = useMemo(() => ['All', 'Needs you', ...Array.from(new Set(books.map((b) => b.phase)))], [books]);
  const shown = useMemo(() => {
    if (filter === 'All') return books;
    if (filter === 'Needs you') return books.filter((b) => b.status !== 'ok');
    return books.filter((b) => b.phase === filter);
  }, [books, filter]);

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Books, <em>in flight</em></h1>

      <div className={styles.filters}>
        {chips.map((c) => (
          <button key={c} className={c === filter ? `${styles.chip} ${styles.on}` : styles.chip} onClick={() => setFilter(c)}>
            {c}
          </button>
        ))}
      </div>

      {error ? (
        <p className={styles.empty}>Couldn't load books — {error}</p>
      ) : (
        <div className={styles.grid}>
          {shown.map((b) => (
            <article key={b.slug} className={b.live ? `${styles.card} ${styles.live}` : styles.card} onClick={() => setOpenSlug(b.slug)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenSlug(b.slug); } }} role="button" tabIndex={0}>
              <span className={b.live ? `${styles.phase} ${styles.gen}` : styles.phase} style={{ ['--ph' as string]: `var(${PHASE_VAR[b.phase] ?? '--ph-plan'})` }}>
                <i /> {b.phase}
              </span>
              <h3>{b.title}</h3>
              {b.genre && <div className={styles.genre}>{b.genre}</div>}
              <div className={styles.byline}>
                <b>{b.author ?? '—'}</b>
                {b.voice && <><span className={styles.v} /> {b.voice}</>}
              </div>
              <div className={styles.prog}>
                <div className={styles.progMeta}><span>{b.phase}</span><b>phase {Math.max(0, PHASE_ORDER.indexOf(b.phase)) + 1} of 6</b></div>
                <div className={styles.bar}>
                  {PHASE_ORDER.map((_, i) => {
                    const cur = PHASE_ORDER.indexOf(b.phase);
                    const cls = i < cur ? styles.lit : i === cur ? styles.cur : '';
                    return <i key={i} className={cls} />;
                  })}
                </div>
              </div>
              {b.live && <div className={styles.livestrip}><span className={styles.pip} />writing · {b.live.stepLabel}</div>}
              {b.next && (
                <div className={styles.next}>
                  <span className={styles.ndot} />
                  <span className={styles.nlbl}>{b.next.label}</span>
                  <span className={styles.nhint}>{b.next.hint}</span>
                </div>
              )}
              <div className={styles.meta}>
                <span className={styles.slug}>{b.slug}</span>
                {b.status !== 'ok' && <span className={styles.flag}>{b.status}</span>}
              </div>
            </article>
          ))}

          {/* New Book ghost card → minimal create form (full picker = 6g) */}
          <article className={`${styles.card} ${styles.ghost}`} onClick={() => navigate('/new-book')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/new-book'); } }} role="button" tabIndex={0}>
            <div className={styles.plus}>+</div>
            <h3>New book</h3>
            <small>Pull author, voice, genre &amp; pipeline from the library.</small>
          </article>
        </div>
      )}

      {openSlug && <BookDrawer slug={openSlug} onClose={() => setOpenSlug(null)} />}
    </div>
  );
}
