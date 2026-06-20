import type { LibraryEntry } from '@bookclaw/shared';
import { sourceBadge } from '../../lib/sourceBadge.js';
import styles from '../../routes/NewBook.module.css';

export function OptionCard({ entry, mode, selected, onToggle, meta, compact }: {
  entry: LibraryEntry; mode: 'single' | 'multi'; selected: boolean; onToggle: () => void; meta?: string; compact?: boolean;
}) {
  const badge = sourceBadge('library', entry.source);
  const cls = [styles.optcard, selected && styles.sel, compact && styles.compact].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      onClick={onToggle}
      aria-pressed={selected}
    >
      {mode === 'single'
        ? (
          <span className={styles.rad}>
            {selected && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                <path d="M5 13l4 4L19 7"/>
              </svg>
            )}
          </span>
        )
        : <span className={`${styles.tog} ${selected ? styles.togOn : ''}`} />}
      <span className={styles.body2}>
        <span className={styles.nm}>
          {entry.name}{' '}
          <span className={`${styles.src} ${styles[badge.cls]}`}>{badge.label}</span>
        </span>
        {entry.description && <span className={styles.dsc}>{entry.description}</span>}
        {meta && <span className={styles.mm}>{meta}</span>}
      </span>
    </button>
  );
}
