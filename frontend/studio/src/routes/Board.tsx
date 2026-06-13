import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useBooks, LIFECYCLE_PHASES } from '@bookclaw/shared';
import { BookDrawer } from '../components/BookDrawer.js';
import styles from './Board.module.css';

const PHASE_VAR: Record<string, string> = {
  planning: '--ph-plan', bible: '--ph-world', production: '--ph-prod',
  revision: '--ph-rev', format: '--ph-fmt', launch: '--ph-launch',
  // novel-pipeline vocabulary → nearest lifecycle color (TODO #15 N-segment board).
  premise: '--ph-plan', outline: '--ph-world', writing: '--ph-prod', assembly: '--ph-fmt',
};

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
          {shown.map((b) => {
            // Per-book pipeline phases (N segments); fall back to the lifecycle list
            // when a book exposes none. cur = -1 (phase not in the list) renders no
            // lit segment — guarded so "phase X of N" never shows phase 0.
            const phases: readonly string[] = b.phases?.length ? b.phases : LIFECYCLE_PHASES;
            const cur = phases.indexOf(b.phase);
            return (
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
                <div className={styles.progMeta}><span>{b.phase}</span><b>phase {Math.max(0, cur) + 1} of {phases.length}</b></div>
                {/* Inline grid override: .bar CSS hardcodes repeat(6); drive the column count from the pipeline's N phases. */}
                <div className={styles.bar} style={{ gridTemplateColumns: `repeat(${phases.length}, 1fr)` }}>
                  {phases.map((p, i) => {
                    const cls = i < cur ? styles.lit : i === cur ? styles.cur : '';
                    return <i key={p} className={cls} />;
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
            );
          })}

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
