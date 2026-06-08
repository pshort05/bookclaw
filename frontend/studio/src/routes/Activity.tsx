import { useEffect, useMemo, useState } from 'react';
import { useStore, useActivity, streamActivity } from '@bookclaw/shared';
import type { ActivityEntry } from '@bookclaw/shared';
import styles from './Activity.module.css';

/** Map an entry to a display category (label + the CSS color var name). */
function category(e: ActivityEntry): { label: string; varName: string } {
  if (typeof e.metadata?.cost === 'number') return { label: 'Cost', varName: '--gold' };
  switch (e.type) {
    case 'step_started': case 'step_completed': case 'step_failed':
    case 'project_created': case 'project_planned':
    case 'goal_created': case 'goal_planned':
      return { label: 'Production', varName: '--ember' };
    case 'provider_selected':
      return { label: 'Model', varName: '--dim' };
    case 'file_saved':
      return { label: 'Book', varName: '--ph-world' };
    case 'skill_matched':
      return { label: 'Skill', varName: '--gold' };
    case 'error':
      return { label: 'Error', varName: '--alert' };
    default:
      return { label: 'System', varName: '--ph-fmt' };
  }
}

const FILTERS = ['All', 'Production', 'Cost', 'Model', 'Book', 'System'] as const;
type Filter = typeof FILTERS[number];

function clock(ts: string): string {
  // HH:MM, local — defensive against a bad timestamp.
  const d = new Date(ts);
  return isNaN(d.getTime()) ? '' : d.toTimeString().slice(0, 5);
}

export function Activity() {
  const entries = useActivity();
  const loadActivity = useStore((s) => s.loadActivity);
  const pushActivity = useStore((s) => s.pushActivity);
  const [filter, setFilter] = useState<Filter>('All');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadActivity().catch((e) => setError(String(e)));
    const stop = streamActivity((entry) => pushActivity(entry), () => { loadActivity().catch(() => {}); });
    return stop;
  }, [loadActivity, pushActivity]);

  const shown = useMemo(
    () => {
      const tagged = entries.map((e) => ({ e, c: category(e) }));
      return filter === 'All' ? tagged : tagged.filter((x) => x.c.label === filter);
    },
    [entries, filter],
  );

  return (
    <div className={styles.scroll}>
      <div className={styles.hero}>
        <h1>Activity, <em>as it happens</em></h1>
        <p>Drafts, model calls, book events, approvals and spend — live.</p>
        <div className={styles.filters}>
          {FILTERS.map((f) => (
            <button
              key={f}
              className={f === filter ? `${styles.chip} ${styles.on}` : styles.chip}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {error && shown.length === 0 && (
        <p className={styles.empty}>Couldn't load activity — {error}</p>
      )}
      <div className={styles.feed}>
        {shown.map(({ e, c }, i) => (
          <div key={`${e.timestamp}-${i}`} className={i === 0 ? `${styles.ev} ${styles.now}` : styles.ev}>
            <span className={styles.ts}>{clock(e.timestamp)}</span>
            <span className={styles.cat} style={{ ['--c' as string]: `var(${c.varName})` }}>
              <i /> {c.label}
            </span>
            <span className={styles.bd}>{e.message}</span>
            <span className={styles.mt}>
              {typeof e.metadata?.cost === 'number'
                ? `$${(e.metadata.cost as number).toFixed(2)}`
                : (e.metadata?.provider as string) ?? ''}
            </span>
          </div>
        ))}
        {shown.length === 0 && !error && <p className={styles.empty}>No activity yet.</p>}
      </div>
    </div>
  );
}
