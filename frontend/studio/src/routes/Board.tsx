import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore, useBooks, LIFECYCLE_PHASES } from '@bookclaw/shared';
import type { BookSummary } from '@bookclaw/shared';
import { BookDrawer } from '../components/BookDrawer.js';
import styles from './Board.module.css';

const PHASE_VAR: Record<string, string> = {
  planning: '--ph-plan', bible: '--ph-world', production: '--ph-prod',
  revision: '--ph-rev', format: '--ph-fmt', launch: '--ph-launch',
  // novel-pipeline vocabulary → nearest lifecycle color (TODO #15 N-segment board).
  premise: '--ph-plan', outline: '--ph-world', writing: '--ph-prod', assembly: '--ph-fmt',
};

// Grouping dimensions for the board. Each book already carries author/series/genre
// on BookSummary, so grouping is purely a client-side view over the loaded list.
const GROUP_DIMS = [
  { key: 'author', label: 'Author' },
  { key: 'series', label: 'Series' },
  { key: 'genre', label: 'Genre' },
] as const;
type GroupKey = (typeof GROUP_DIMS)[number]['key'];

// The group bucket a book falls into for the active dimension. Missing values get
// a clear catch-all label (books with no series are "Standalone").
function groupValue(b: BookSummary, key: GroupKey): string {
  const raw = key === 'author' ? b.author : key === 'series' ? b.series : b.genre;
  const v = (raw ?? '').trim();
  if (v) return v;
  return key === 'series' ? 'Standalone' : 'Unassigned';
}

const FALLBACK_LABELS = new Set(['Standalone', 'Unassigned']);

export function Board() {
  const books = useBooks();
  const loadBooks = useStore((s) => s.loadBooks);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('All');
  const [groupBy, setGroupBy] = useState<'none' | GroupKey>('none');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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

  // Group the phase-filtered books by the active dimension; null when ungrouped.
  // Buckets sort alphabetically with the catch-all (Standalone/Unassigned) last.
  const groups = useMemo(() => {
    if (groupBy === 'none') return null;
    const map = new Map<string, BookSummary[]>();
    for (const b of shown) {
      const k = groupValue(b, groupBy);
      const list = map.get(k);
      if (list) list.push(b); else map.set(k, [b]);
    }
    return [...map.entries()].sort(([a], [z]) => {
      const af = FALLBACK_LABELS.has(a), zf = FALLBACK_LABELS.has(z);
      if (af !== zf) return af ? 1 : -1;
      return a.localeCompare(z);
    });
  }, [shown, groupBy]);

  // Selecting the active dimension again clears grouping; switching dimension
  // resets which groups are collapsed (keys differ between dimensions).
  const pickGroup = (k: GroupKey) => {
    setGroupBy((cur) => (cur === k ? 'none' : k));
    setCollapsed(new Set());
  };
  const toggleCollapse = (key: string) =>
    setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  // One card — shared by the flat grid and the grouped view.
  const renderCard = (b: BookSummary) => {
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
          {b.series && <><span className={styles.v} /> <span className={styles.series} title={b.series}>◈ {b.series}</span></>}
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
  };

  // New Book ghost card → minimal create form (full picker = 6g).
  const ghostCard = (
    <article className={`${styles.card} ${styles.ghost}`} onClick={() => navigate('/new-book')} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/new-book'); } }} role="button" tabIndex={0}>
      <div className={styles.plus}>+</div>
      <h3>New book</h3>
      <small>Pull author, voice, genre &amp; pipeline from the library.</small>
    </article>
  );

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Books, <em>in flight</em></h1>

      <div className={styles.filters}>
        {chips.map((c) => (
          <button key={c} className={c === filter ? `${styles.chip} ${styles.on}` : styles.chip} onClick={() => setFilter(c)}>
            {c}
          </button>
        ))}
        <span className={styles.fsep} aria-hidden="true" />
        <span className={styles.grouplbl}>Group by</span>
        {GROUP_DIMS.map((g) => (
          <button key={g.key} className={groupBy === g.key ? `${styles.chip} ${styles.on}` : styles.chip} onClick={() => pickGroup(g.key)}>
            {g.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className={styles.empty}>Couldn't load books — {error}</p>
      ) : groups ? (
        <>
          {groups.map(([key, members]) => {
            const open = !collapsed.has(key);
            return (
              <div key={key} className={styles.groupBlock}>
                <button type="button" className={styles.ghead} onClick={() => toggleCollapse(key)} aria-expanded={open}>
                  <span className={styles.gtw} aria-hidden="true">{open ? '▾' : '▸'}</span>
                  <span className={styles.glabel}>{key}</span>
                  <span className={styles.gcount}>{members.length}</span>
                </button>
                {open && <div className={styles.grid}>{members.map(renderCard)}</div>}
              </div>
            );
          })}
          <div className={styles.grid}>{ghostCard}</div>
        </>
      ) : (
        <div className={styles.grid}>
          {shown.map(renderCard)}
          {ghostCard}
        </div>
      )}

      {openSlug && <BookDrawer slug={openSlug} onClose={() => setOpenSlug(null)} />}
    </div>
  );
}
