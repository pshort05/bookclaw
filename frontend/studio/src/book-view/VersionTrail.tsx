import { pickVersion, type Version } from './types.js';
import styles from './VersionTrail.module.css';

/** "10 Sep, 10:11" — short, local, and blank for a missing/unparseable stamp. */
function when(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * The ordered version trail (design §2): every step that produced this item,
 * oldest first, with only the last marked `latest`. Selecting an earlier one
 * puts both panes into read-only — the server decides that via `editable`;
 * this component only reports the choice.
 */
export function VersionTrail({ versions, selectedId, note, onSelect }: {
  versions: Version[];
  selectedId: string | null;
  /** Right-hand caption: the version's timestamp, or a state word when there are none. */
  note: string;
  onSelect: (versionId: string) => void;
}) {
  if (versions.length === 0) {
    return (
      <div className={styles.trail}>
        <div className={styles.vers}><button aria-pressed="true" disabled>No versions</button></div>
        {note && <div className={styles.when}>{note}</div>}
      </div>
    );
  }

  const selected = pickVersion(versions, selectedId);

  return (
    <div className={styles.trail}>
      <div className={styles.vers}>
        {versions.map((v) => (
          <button
            key={v.id}
            data-latest={v.latest ? '1' : '0'}
            aria-pressed={v.id === selected.id}
            onClick={() => onSelect(v.id)}
          >
            {v.step && <span className={styles.st}>{v.step}</span>}
            {v.label}{v.latest ? ' · latest' : ''}
          </button>
        ))}
      </div>
      <div className={styles.when}>{when(selected.createdAt) || note}</div>
    </div>
  );
}
