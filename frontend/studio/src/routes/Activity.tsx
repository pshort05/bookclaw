import { useEffect, useMemo, useState } from 'react';
import { api, useStore, useActivity, useCosts, streamActivity, hhmmss, money } from '@bookclaw/shared';
import type { ActivityEntry, Status } from '@bookclaw/shared';
import styles from './Activity.module.css';

/** Map an entry to a display category (label + the CSS color var name). */
function category(e: ActivityEntry): { label: string; varName: string } {
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
      if (typeof e.metadata?.cost === 'number') return { label: 'Cost', varName: '--gold' };
      return { label: 'System', varName: '--ph-fmt' };
  }
}

const FILTERS = ['All', 'Production', 'Cost', 'Model', 'Book', 'System'] as const;
type Filter = typeof FILTERS[number];

export function Activity() {
  const entries = useActivity();
  const loadActivity = useStore((s) => s.loadActivity);
  const pushActivity = useStore((s) => s.pushActivity);
  const [filter, setFilter] = useState<Filter>('All');
  const [error, setError] = useState<string | null>(null);

  // Overview figures (merged from the former Insights screen).
  const costs = useCosts();
  const loadCosts = useStore((s) => s.loadCosts);
  const [status, setStatus] = useState<Status | null>(null);
  const [counts, setCounts] = useState<{ books?: number; series?: number; authors?: number; worlds?: number; projects?: number; personas?: number }>({});

  useEffect(() => {
    loadActivity().catch((e) => setError(String(e)));
    const stop = streamActivity((entry) => pushActivity(entry), () => { loadActivity().catch(() => {}); });
    return stop;
  }, [loadActivity, pushActivity]);

  useEffect(() => {
    loadCosts().catch(() => {});
    let cancelled = false;
    Promise.all([
      api<Status>('/api/status').catch(() => null),
      api<{ books: unknown[] }>('/api/books').catch(() => ({ books: [] })),
      api<{ series: unknown[] }>('/api/series').catch(() => ({ series: [] })),
      api<{ entries: unknown[] }>('/api/library?kind=author').catch(() => ({ entries: [] })),
      api<{ entries: unknown[] }>('/api/library?kind=world').catch(() => ({ entries: [] })),
      api<{ projects: unknown[] }>('/api/projects/list').catch(() => ({ projects: [] })),
      api<{ personas: unknown[] }>('/api/personas').catch(() => ({ personas: [] })),
    ]).then(([st, b, se, au, wo, p, pe]) => {
      if (cancelled) return;
      setStatus(st);
      setCounts({
        books: b?.books?.length,
        series: se?.series?.length,
        authors: au?.entries?.length,
        worlds: wo?.entries?.length,
        projects: p?.projects?.length,
        personas: pe?.personas?.length,
      });
    });
    return () => { cancelled = true; };
  }, [loadCosts]);

  const dailyPct = costs && costs.dailyLimit > 0 ? Math.min(100, (costs.daily / costs.dailyLimit) * 100) : 0;
  const monthlyPct = costs && costs.monthlyLimit > 0 ? Math.min(100, (costs.monthly / costs.monthlyLimit) * 100) : 0;

  const shown = useMemo(
    () => {
      const tagged = entries.map((e) => ({ e, c: category(e) }));
      return filter === 'All' ? tagged : tagged.filter((x) => x.c.label === filter);
    },
    [entries, filter],
  );

  return (
    <div className={styles.scroll}>
      {/* Overview — spend + counts (merged from the former Insights screen) */}
      <div className={styles.cards}>
        <div className={styles.card}>
          <div className={styles.cap}>
            <span>AI spend · today</span>
            <b>{money(costs?.daily ?? 0)} / ${(costs?.dailyLimit ?? 0).toFixed(2)}</b>
          </div>
          <div className={styles.bar}>
            <i style={{ width: `${dailyPct}%` }} className={costs?.overBudget ? styles.over : undefined} />
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cap}>
            <span>AI spend · month</span>
            <b>{money(costs?.monthly ?? 0)} / ${(costs?.monthlyLimit ?? 0).toFixed(2)}</b>
          </div>
          <div className={styles.bar}>
            <i style={{ width: `${monthlyPct}%` }} />
          </div>
        </div>
      </div>
      <div className={styles.stats}>
        <Stat label="Books" value={counts.books} />
        <Stat label="Series" value={counts.series} />
        <Stat label="Authors" value={counts.authors} />
        <Stat label="Worlds" value={counts.worlds} />
        <Stat label="Projects" value={counts.projects} />
        <Stat label="Personas" value={counts.personas} />
        <Stat label="Skills" value={status?.skills?.total} />
        <Stat label="Providers" value={status?.providers?.length} />
      </div>

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
            <span className={styles.ts}>{hhmmss(e.timestamp)}</span>
            <span className={styles.cat} style={{ ['--c' as string]: `var(${c.varName})` }}>
              <i /> {c.label}
            </span>
            <span className={styles.bd}>{e.message}</span>
            <span className={styles.mt}>
              {typeof e.metadata?.cost === 'number'
                ? money(e.metadata.cost as number)
                : (e.metadata?.provider as string) ?? ''}
            </span>
          </div>
        ))}
        {shown.length === 0 && !error && <p className={styles.empty}>No activity yet.</p>}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statN}>{value ?? '—'}</div>
      <div className={styles.statL}>{label}</div>
    </div>
  );
}
