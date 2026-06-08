import { useEffect, useState } from 'react';
import { useStore, useBooks } from '@bookclaw/shared';
import styles from './Board.module.css';

const PHASE_VAR: Record<string, string> = {
  planning: '--ph-plan', bible: '--ph-world', production: '--ph-prod',
  revision: '--ph-rev', format: '--ph-fmt', launch: '--ph-launch',
};

export function Board() {
  const books = useBooks();
  const loadBooks = useStore((s) => s.loadBooks);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { loadBooks().catch((e) => setError(String(e))); }, [loadBooks]);

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Books, <em>in flight</em></h1>
      {error ? (
        <p className={styles.empty}>Couldn’t load books — {error}</p>
      ) : books.length === 0 ? (
        <p className={styles.empty}>No books yet. Create one to begin.</p>
      ) : (
        <div className={styles.grid}>
          {books.map((b) => (
            <article key={b.slug} className={styles.card}>
              <span className={styles.phase} style={{ ['--ph' as string]: `var(${PHASE_VAR[b.phase] ?? '--ph-plan'})` }}>
                <i /> {b.phase}
              </span>
              <h3>{b.title}</h3>
              <div className={styles.meta}>
                <span className={styles.slug}>{b.slug}</span>
                {b.status && b.status !== 'ok' && <span className={styles.flag}>{b.status}</span>}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
