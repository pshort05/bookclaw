import { useActiveBook, useCosts, useStore } from '@bookclaw/shared';
import { useEffect } from 'react';
import styles from '../App.module.css';

export function Stats() {
  const activeBook = useActiveBook();
  const costs = useCosts();
  const loadCosts = useStore((s) => s.loadCosts);

  useEffect(() => {
    loadCosts().catch(() => {});
  }, [loadCosts]);

  if (!activeBook) return null;

  const spendPct = costs && costs.dailyLimit > 0
    ? Math.min(100, (costs.daily / costs.dailyLimit) * 100)
    : 0;

  return (
    <div className={styles.stats}>
      <div className={styles.stitle}>{activeBook.title}</div>

      <div className={styles.stat}>
        <span className={styles.statKey}>Phase</span>
        <span className={styles.statVal}>{activeBook.phase}</span>
      </div>

      {costs && (
        <>
          <div className={styles.stat}>
            <span className={styles.statKey}>Spent today</span>
            <span className={`${styles.statVal} ${styles.statValGold}`}>
              ${costs.daily.toFixed(2)}
            </span>
          </div>
          <div className={styles.pbar}>
            <i style={{ width: `${spendPct}%` }} />
          </div>
        </>
      )}
    </div>
  );
}
