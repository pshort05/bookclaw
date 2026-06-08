import { useEffect, useState, useCallback } from 'react';
import type { LibraryEntry, LibraryKind } from '@bookclaw/shared';
import type { Scope } from '../../lib/assetApi.js';
import { listEntries, createLibraryEntry, deleteLibraryEntry, readEntry } from '../../lib/assetApi.js';
import { sourceBadge } from '../../lib/sourceBadge.js';
import { GLOSSARY } from '../../lib/glossary.js';
import styles from '../../routes/AssetStudio.module.css';

// Plural display labels for the list header (local to this component).
const KIND_LABELS: Record<LibraryKind, string> = {
  author: 'Authors', voice: 'Voices', genre: 'Genres',
  pipeline: 'Pipelines', section: 'Sections', skill: 'Skills',
};

// Composed view used within this component (label + canon + def).
const KIND_DEFS: Record<LibraryKind, { label: string; canon: string; def: string }> = Object.fromEntries(
  (Object.keys(GLOSSARY) as LibraryKind[]).map((k) => [k, { label: KIND_LABELS[k], ...GLOSSARY[k] }]),
) as Record<LibraryKind, { label: string; canon: string; def: string }>;

const WRITABLE_KINDS: LibraryKind[] = ['author', 'voice', 'genre', 'pipeline', 'section'];

const STARTER_PIPELINE_JSON = JSON.stringify({ schemaVersion: 1, name: 'new-pipeline', label: 'New Pipeline', description: '', steps: [] }, null, 2);

interface Props {
  scope: Scope;
  kind: LibraryKind;
  selectedName: string | null;
  onSelect: (name: string | null) => void;
}


export function EntryList({ scope, kind, selectedName, onSelect }: Props) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = KIND_DEFS[kind];

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listEntries(scope, kind)
      .then(setEntries)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [scope, kind]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listEntries(scope, kind)
      .then((result) => { if (!cancelled) setEntries(result); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, kind]);

  async function handleAdd() {
    if (scope !== 'library') return;
    const name = window.prompt(`New ${meta.canon.toLowerCase()} name (lowercase, hyphens only):`);
    if (!name) return;
    try {
      if (kind === 'pipeline') {
        await createLibraryEntry(kind, name, { content: STARTER_PIPELINE_JSON });
      } else if (kind === 'section') {
        await createLibraryEntry(kind, name, { content: `# ${name}\n` });
      } else {
        await createLibraryEntry(kind, name, { files: { 'NOTES.md': '' } });
      }
      load();
      onSelect(name);
    } catch (e) {
      alert(`Could not create: ${e}`);
    }
  }

  async function handleDelete(entry: LibraryEntry, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (scope !== 'library' || entry.source !== 'workspace') return;
    if (!window.confirm(`Delete ${entry.name}? This will revert to the built-in if one exists.`)) return;
    try {
      await deleteLibraryEntry(kind, entry.name);
      load();
      if (selectedName === entry.name) onSelect(null);
    } catch (e) {
      alert(`Could not delete: ${e}`);
    }
  }

  const canCreate = scope === 'library' && WRITABLE_KINDS.includes(kind);

  return (
    <div className={styles.entries}>
      <div className={styles.ehead}>
        <h3>
          {meta.label} <span className={styles.canon} title="Canonical term (GLOSSARY.md)">term · {meta.canon}</span>
        </h3>
        {canCreate && (
          <button className={styles.addnew} title={`New ${meta.canon.toLowerCase()}`} onClick={handleAdd}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </button>
        )}
      </div>
      <div className={styles.kdef}>{meta.def}</div>

      {loading && <div style={{ color: 'var(--faint)', fontSize: 12 }}>Loading…</div>}
      {error && <div style={{ color: 'var(--alert)', fontSize: 12 }}>{error}</div>}

      {entries.map((e) => (
        <div
          key={e.name}
          className={`${styles.entry}${selectedName === e.name ? ' ' + styles.on : ''}`}
          onClick={() => onSelect(e.name)}
          role="button"
          tabIndex={0}
          onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') onSelect(e.name); }}
        >
          <div className={styles.et}>
            <span>{e.name}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {(() => { const b = sourceBadge(scope, e.source); return <span className={`${styles.src} ${styles[b.cls]}`}>{b.label}</span>; })()}
              {scope === 'library' && e.source === 'workspace' && (
                <button
                  onClick={(ev) => handleDelete(e, ev)}
                  title="Delete overlay"
                  style={{ border: 'none', background: 'transparent', color: 'var(--faint)', cursor: 'pointer', padding: '2px 4px', fontSize: 11 }}
                >
                  ×
                </button>
              )}
            </div>
          </div>
          {e.description && <div className={styles.ed}>{e.description}</div>}
        </div>
      ))}
    </div>
  );
}

