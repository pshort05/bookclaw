import { useState } from 'react';
import { GROUP_ORDER, chapterNumber, isFlagged, type BookItem, type Group, type RunState } from './types.js';
import styles from './BookContents.module.css';

type Filter = 'all' | 'ready' | 'flag';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Written' },
  { id: 'flag', label: 'Flagged' },
];

/** Reading order (front → launch); unknown group ids sort last, in server order. */
function inOrder(groups: Group[]): Group[] {
  const rank = (g: Group) => {
    const i = GROUP_ORDER.indexOf(g.id);
    return i === -1 ? GROUP_ORDER.length : i;
  };
  return [...groups].sort((a, b) => rank(a) - rank(b));
}

function matches(item: BookItem, filter: Filter): boolean {
  if (filter === 'ready') return item.ready;
  if (filter === 'flag') return isFlagged(item);
  return true;
}

function Chips({ item, gated }: { item: BookItem; gated: boolean }) {
  const flags = item.flags ?? [];
  if (!gated && flags.length === 0) return null;
  return (
    <>
      {gated && <span className={`${styles.chip} ${styles.warn}`}>gate</span>}
      {flags.map((f, i) => (
        <span key={`${f.label}-${i}`} className={`${styles.chip} ${styles[f.level]}`}>{f.label}</span>
      ))}
    </>
  );
}

function Row({ item, run, selected, onSelect }: {
  item: BookItem;
  run: RunState;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const ch = chapterNumber(item.id);
  const gated = run.status === 'gated' && run.gate?.itemId === item.id;
  const writing = run.status === 'writing' && ch !== null && ch === run.frontier;
  // A chapter the pipeline hasn't reached reads as "not written"; anything else
  // that isn't ready is a ghost row — the skill that makes it hasn't run.
  const cls = [
    styles.row,
    item.kind === 'prose' ? '' : styles.doc,
    item.ready ? '' : ch !== null ? styles.unwritten : styles.ghost,
  ].filter(Boolean).join(' ');

  return (
    <button className={cls} aria-current={selected} onClick={() => onSelect(item.id)}>
      <span className={styles.num}>
        {item.ready ? (ch !== null ? String(ch).padStart(2, '0') : '·') : '□'}
      </span>
      <span>
        <span className={styles.ttl}>{item.title}</span>
        <span className={styles.sub}>
          {item.ready
            ? item.words != null && <span className={styles.w}>{item.words.toLocaleString()} w</span>
            : <span className={styles.w}>{ch !== null ? 'not written' : 'not generated'}</span>}
          {writing && <span className={`${styles.chip} ${styles.warn}`}>writing now</span>}
          <Chips item={item} gated={gated} />
        </span>
      </span>
    </button>
  );
}

/**
 * The grouped contents rail (design §2): front → manuscript → back → reference
 * → launch, with the All / Written / Flagged filters. Rows are data — the rail
 * knows nothing about chapters beyond the number in a `chapter:N` id.
 */
export function BookContents({ groups, run, selectedId, onSelect }: {
  groups: Group[];
  run: RunState;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const ordered = inOrder(groups);
  const all = ordered.flatMap((g) => g.items);
  const counts: Record<Filter, number> = {
    all: all.length,
    ready: all.filter((i) => i.ready).length,
    flag: all.filter(isFlagged).length,
  };
  const shown = ordered
    .map((g) => ({ group: g, items: g.items.filter((i) => matches(i, filter)) }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <div className={styles.railhead}>
        <div className={styles.kicker}>Contents</div>
        <div className={styles.filters}>
          {FILTERS.map((f) => (
            <button key={f.id} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}<span className={styles.n}>{counts[f.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className={styles.none}>
          {filter === 'flag' ? 'Nothing flagged.' : filter === 'ready' ? 'Nothing written yet.' : 'This book has no contents yet.'}
        </div>
      ) : shown.map(({ group, items }) => (
        <div key={group.id}>
          <div className={styles.grp}>
            {group.label}<span className={styles.gline} /><span className={styles.gstate}>{group.state}</span>
          </div>
          <div className={styles.toc}>
            {items.map((item) => (
              <Row
                key={item.id}
                item={item}
                run={run}
                selected={item.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
