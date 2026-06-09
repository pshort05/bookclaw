import { useEffect, useState } from 'react';
import { api, useStore, useCosts, useActivity, hhmm } from '@bookclaw/shared';
import type { Status, ActivityEntry } from '@bookclaw/shared';
import styles from './Insights.module.css';

export function Insights() {
  const costs = useCosts();
  const activity = useActivity();
  const loadCosts = useStore((s) => s.loadCosts);
  const loadActivity = useStore((s) => s.loadActivity);
  const [status, setStatus] = useState<Status | null>(null);
  const [counts, setCounts] = useState<{ books?: number; projects?: number; personas?: number }>({});

  useEffect(() => {
    loadCosts().catch(() => {});
    loadActivity(8).catch(() => {});
    let cancelled = false;
    Promise.all([
      api<Status>('/api/status').catch(() => null),
      api<{ books: unknown[] }>('/api/books').catch(() => ({ books: [] })),
      api<{ projects: unknown[] }>('/api/projects/list').catch(() => ({ projects: [] })),
      api<{ personas: unknown[] }>('/api/personas').catch(() => ({ personas: [] })),
    ]).then(([st, b, p, pe]) => {
      if (cancelled) return;
      setStatus(st);
      setCounts({
        books: b?.books?.length,
        projects: p?.projects?.length,
        personas: pe?.personas?.length,
      });
    });
    return () => { cancelled = true; };
  }, [loadCosts, loadActivity]);

  const dailyPct =
    costs && costs.dailyLimit > 0
      ? Math.min(100, (costs.daily / costs.dailyLimit) * 100)
      : 0;
  const monthlyPct =
    costs && costs.monthlyLimit > 0
      ? Math.min(100, (costs.monthly / costs.monthlyLimit) * 100)
      : 0;

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Insights</h1>

      {/* Spend */}
      <div className={styles.cards}>
        <div className={styles.card}>
          <div className={styles.cap}>
            <span>AI spend · today</span>
            <b>${(costs?.daily ?? 0).toFixed(2)} / ${costs?.dailyLimit ?? 0}</b>
          </div>
          <div className={styles.bar}>
            <i
              style={{ width: `${dailyPct}%` }}
              className={costs?.overBudget ? styles.over : undefined}
            />
          </div>
        </div>
        <div className={styles.card}>
          <div className={styles.cap}>
            <span>AI spend · month</span>
            <b>${(costs?.monthly ?? 0).toFixed(2)} / ${costs?.monthlyLimit ?? 0}</b>
          </div>
          <div className={styles.bar}>
            <i style={{ width: `${monthlyPct}%` }} />
          </div>
        </div>
      </div>

      {/* Counts */}
      <div className={styles.stats}>
        <Stat label="Books" value={counts.books} />
        <Stat label="Projects" value={counts.projects} />
        <Stat label="Personas" value={counts.personas} />
        <Stat label="Skills" value={status?.skills?.total} />
        <Stat label="Providers" value={status?.providers?.length} />
      </div>

      {/* Recent activity */}
      <div className={styles.sec}>Recent activity</div>
      <div className={styles.feed}>
        {activity.slice(0, 8).map((e: ActivityEntry, i) => (
          <div key={`${e.timestamp}-${i}`} className={styles.ev}>
            <span className={styles.ts}>{hhmm(e.timestamp)}</span>
            <span className={styles.bd}>{e.message}</span>
          </div>
        ))}
        {activity.length === 0 && <p className={styles.dim}>No activity yet.</p>}
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
