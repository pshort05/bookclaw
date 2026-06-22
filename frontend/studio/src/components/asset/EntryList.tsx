import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api, apiBase, authToken } from '@bookclaw/shared';
import type { LibraryEntry, LibraryKind } from '@bookclaw/shared';
import type { Scope } from '../../lib/assetApi.js';
import { listEntries, createLibraryEntry, deleteLibraryEntry, readEntry } from '../../lib/assetApi.js';
import { sourceBadge } from '../../lib/sourceBadge.js';
import { GENRE_GROUPS } from '../../lib/genreGroups.js';
import { GLOSSARY } from '../../lib/glossary.js';
import { useDialog } from '../Dialog.js';
import styles from '../../routes/AssetStudio.module.css';

// Plural display labels for the list header (local to this component).
const KIND_LABELS: Record<LibraryKind, string> = {
  author: 'Authors', voice: 'Voices', genre: 'Genres',
  pipeline: 'Pipelines', sequence: 'Sequences', section: 'Sections', skill: 'Skills',
  editor: 'Editors', prompt: 'Prompts', world: 'Worlds',
};

// Composed view used within this component (label + canon + def).
const KIND_DEFS: Record<LibraryKind, { label: string; canon: string; def: string }> = Object.fromEntries(
  (Object.keys(GLOSSARY) as LibraryKind[]).map((k) => [k, { label: KIND_LABELS[k], ...GLOSSARY[k] }]),
) as Record<LibraryKind, { label: string; canon: string; def: string }>;

const WRITABLE_KINDS: LibraryKind[] = ['author', 'voice', 'genre', 'pipeline', 'sequence', 'section', 'editor', 'prompt', 'world'];

const STARTER_PIPELINE_JSON = JSON.stringify({ schemaVersion: 1, name: 'new-pipeline', label: 'New Pipeline', description: '', steps: [] }, null, 2);
const STARTER_SEQUENCE_JSON = JSON.stringify({ schemaVersion: 1, name: 'new-sequence', label: 'New Sequence', description: '', pipelines: [] }, null, 2);
const STARTER_EDITOR_JSON = JSON.stringify({ schemaVersion: 1, name: 'new-editor', label: 'New Editor', description: '', systemPrompt: 'You are an interactive developmental editor.' }, null, 2);
const STARTER_PROMPT_JSON = JSON.stringify({ schemaVersion: 1, name: 'new-prompt', label: 'New Prompt', description: '', systemPrompt: 'You are a writing-craft assistant. Return the revised text.' }, null, 2);
const STARTER_WORLD_JSON = JSON.stringify({
  schemaVersion: 1, name: 'new-world', label: 'New World', description: '',
  documentTypes: [], domains: [], clearanceLevels: [],
  classificationScheme: '{TYPE}-{DOMAIN}-{NNNN}', formatDirective: '', stripCodesInAppendix: true,
}, null, 2);

interface Props {
  scope: Scope;
  kind: LibraryKind;
  selectedName: string | null;
  onSelect: (name: string | null) => void;
}

// Mirrors the server's transfer-security.ts shape (pattern may be omitted).
interface ImportFinding { path: string; type: string; confidence: number; pattern?: string }

// Persisted pending-import handle — survives navigation to /confirmations and back.
const PENDING_IMPORT_KEY = 'bookclaw.pendingLibraryImport';
type PendingImport = { id: string; findings: ImportFinding[] };

function loadPendingImport(): PendingImport | null {
  try {
    const raw = localStorage.getItem(PENDING_IMPORT_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PendingImport;
    return v && typeof v.id === 'string' ? { id: v.id, findings: Array.isArray(v.findings) ? v.findings : [] } : null;
  } catch {
    return null;
  }
}

function savePendingImport(v: PendingImport): void {
  try { localStorage.setItem(PENDING_IMPORT_KEY, JSON.stringify(v)); } catch { /* storage full / disabled — non-fatal */ }
}

function clearPendingImport(): void {
  try { localStorage.removeItem(PENDING_IMPORT_KEY); } catch { /* non-fatal */ }
}

// Export URL with the ?token= query fallback (native download — no Authorization header).
function exportUrl(kind: LibraryKind, name: string): string {
  const t = authToken();
  return `${apiBase()}/api/library/${kind}/${encodeURIComponent(name)}/export${t ? `?token=${encodeURIComponent(t)}` : ''}`;
}

export function EntryList({ scope, kind, selectedName, onSelect }: Props) {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importPending, setImportPending] = useState<{ id: string; findings: ImportFinding[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [genreQuery, setGenreQuery] = useState('');
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const { confirm, prompt, alert } = useDialog();

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
    setGenreQuery('');
    listEntries(scope, kind)
      .then((result) => { if (!cancelled) setEntries(result); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, kind]);

  // Re-hydrate a held import so the Finalize panel reappears after the user
  // visits /confirmations to approve it (navigating away unmounts this component).
  useEffect(() => {
    const p = loadPendingImport();
    if (p) setImportPending(p);
  }, []);

  async function handleAdd() {
    if (scope !== 'library') return;
    const name = await prompt(`New ${meta.canon.toLowerCase()} name (lowercase, hyphens only):`);
    if (!name) return;
    try {
      if (kind === 'pipeline') {
        await createLibraryEntry(kind, name, { content: STARTER_PIPELINE_JSON });
      } else if (kind === 'sequence') {
        await createLibraryEntry(kind, name, { content: STARTER_SEQUENCE_JSON });
      } else if (kind === 'editor') {
        await createLibraryEntry(kind, name, { content: STARTER_EDITOR_JSON });
      } else if (kind === 'prompt') {
        await createLibraryEntry(kind, name, { content: STARTER_PROMPT_JSON });
      } else if (kind === 'world') {
        await createLibraryEntry(kind, name, { content: STARTER_WORLD_JSON });
      } else if (kind === 'section') {
        await createLibraryEntry(kind, name, { content: `# ${name}\n` });
      } else {
        await createLibraryEntry(kind, name, { files: { 'NOTES.md': '' } });
      }
      load();
      onSelect(name);
    } catch (e) {
      await alert(`Could not create: ${e}`);
    }
  }

  async function handleDelete(entry: LibraryEntry, ev: React.MouseEvent) {
    ev.stopPropagation();
    if (scope !== 'library' || entry.source !== 'workspace') return;
    if (!(await confirm(`Delete ${entry.name}? This will revert to the built-in if one exists.`))) return;
    try {
      await deleteLibraryEntry(kind, entry.name);
      load();
      if (selectedName === entry.name) onSelect(null);
    } catch (e) {
      await alert(`Could not delete: ${e}`);
    }
  }

  // Multipart upload — the shared api() helper is JSON-only (forces Content-Type),
  // so go through fetch directly with the bearer header.
  async function handleImportFile(file: File) {
    setImporting(true);
    setImportMsg(null);
    setImportPending(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const t = authToken();
      const res = await fetch(`${apiBase()}/api/library/import`, {
        method: 'POST',
        headers: t ? { Authorization: `Bearer ${t}` } : undefined,
        body: fd,
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        entry?: { kind: string; name: string };
        pendingConfirmation?: string;
        findings?: ImportFinding[];
        error?: string;
      };
      if (res.status === 200) {
        setImportMsg(body.entry ? `Imported ${body.entry.kind} "${body.entry.name}".` : 'Imported.');
        load();
      } else if (res.status === 202 && body.pendingConfirmation) {
        const pending = { id: body.pendingConfirmation, findings: body.findings ?? [] };
        setImportPending(pending);
        savePendingImport(pending);
      } else {
        setImportMsg(`Import failed — ${body.error ?? `HTTP ${res.status}`}`);
      }
    } catch (e) {
      setImportMsg(`Import failed — ${String(e)}`);
    } finally {
      setImporting(false);
    }
  }

  async function finalizeImport() {
    if (!importPending) return;
    setImportMsg(null);
    try {
      const r = await api<{ ok: boolean; entry?: { kind: string; name: string } }>('/api/library/import/finalize', {
        method: 'POST',
        body: JSON.stringify({ confirmationId: importPending.id }),
      });
      setImportPending(null);
      clearPendingImport();
      setImportMsg(r.entry ? `Imported ${r.entry.kind} "${r.entry.name}".` : 'Imported.');
      load();
    } catch (e) {
      const status = (e as { status?: number })?.status;
      if (status === 404) {
        // Expired / already consumed — the held import is dead; drop the Finalize affordance.
        setImportPending(null);
        clearPendingImport();
        setImportMsg('Expired — re-import the file.');
      } else if (status === 409) {
        // Not approved yet — keep the pending state so the user can finalize after approving.
        setImportMsg('Not approved yet — approve it on the Confirmations page first.');
      } else {
        setImportMsg(`Couldn't finalize — ${String(e)}`);
      }
    }
  }

  const canCreate = scope === 'library' && WRITABLE_KINDS.includes(kind);

  // Genres get a search box + collapsible publishing-standard groups (library
  // scope only — book scope returns a single snapshot with no groups).
  const useGroups = kind === 'genre' && scope === 'library';
  const toggleGroup = (slug: string) =>
    setOpenGroups((s) => { const n = new Set(s); if (n.has(slug)) n.delete(slug); else n.add(slug); return n; });

  const renderEntry = (e: LibraryEntry) => (
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
          {scope === 'library' && e.source !== 'synthetic' && (
            <a
              href={exportUrl(kind, e.name)}
              onClick={(ev) => ev.stopPropagation()}
              title="Export as zip"
              style={{ color: 'var(--faint)', textDecoration: 'none', padding: '2px 4px', fontSize: 11, lineHeight: 1 }}
            >
              ↓
            </a>
          )}
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
  );

  const renderGenreGroups = () => {
    const q = genreQuery.trim().toLowerCase();
    if (q) {
      const hits = entries.filter((e) =>
        `${e.name.replace(/-/g, ' ')} ${e.name} ${e.description ?? ''}`.toLowerCase().includes(q));
      return hits.length
        ? <>{hits.map(renderEntry)}</>
        : <div style={{ color: 'var(--faint)', fontSize: 12 }}>No genres match "{genreQuery}".</div>;
    }
    const grouped = GENRE_GROUPS
      .map((grp) => ({ ...grp, members: entries.filter((e) => e.groups?.includes(grp.slug)) }))
      .filter((grp) => grp.members.length > 0);
    const ungrouped = entries.filter((e) => !GENRE_GROUPS.some((grp) => e.groups?.includes(grp.slug)));
    const block = (slug: string, label: string, members: LibraryEntry[]) => {
      const open = openGroups.has(slug) || members.some((e) => e.name === selectedName);
      return (
        <div key={slug} style={{ marginBottom: 6 }}>
          <button type="button" className={styles.ghead} onClick={() => toggleGroup(slug)} aria-expanded={open}>
            <span className={styles.gtw} aria-hidden="true">{open ? '▾' : '▸'}</span>
            <span className={styles.glabel}>{label}</span>
            <span className={styles.gcount}>{members.length}</span>
          </button>
          {open && <div style={{ marginTop: 8 }}>{members.map(renderEntry)}</div>}
        </div>
      );
    };
    return (
      <>
        {grouped.map((grp) => block(grp.slug, grp.label, grp.members))}
        {ungrouped.length > 0 && block('_ungrouped', 'Other', ungrouped)}
      </>
    );
  };

  return (
    <div className={styles.entries}>
      <div className={styles.ehead}>
        <h3>
          {meta.label} <span className={styles.canon} title="Canonical term (GLOSSARY.md)">term · {meta.canon}</span>
        </h3>
        <div style={{ display: 'flex', gap: 6 }}>
          {scope === 'library' && (
            <button
              className={styles.addnew}
              title="Import entry… (.zip)"
              onClick={() => fileRef.current?.click()}
              disabled={importing}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 20h16"/>
              </svg>
            </button>
          )}
          {canCreate && (
            <button className={styles.addnew} title={`New ${meta.canon.toLowerCase()}`} onClick={handleAdd}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".zip"
          style={{ display: 'none' }}
          onChange={(ev) => {
            const f = ev.target.files?.[0];
            ev.target.value = '';
            if (f) handleImportFile(f);
          }}
        />
      </div>
      <div className={styles.kdef}>{meta.def}</div>

      {scope === 'library' && importing && <div className={styles.imsg}>Importing…</div>}
      {scope === 'library' && importMsg && <div className={styles.imsg}>{importMsg}</div>}
      {scope === 'library' && importPending && (
        <div className={styles.ipending}>
          <div>
            Import held for review — {importPending.findings.length} finding
            {importPending.findings.length === 1 ? '' : 's'}:
          </div>
          <ul>
            {importPending.findings.map((f, i) => (
              <li key={i}><code>{f.path}</code> — {f.type}</li>
            ))}
          </ul>
          <span>
            Pending approval in <Link to="/confirmations">Confirmations</Link> — approve there, then finalize.
          </span>
          <button onClick={finalizeImport}>Finalize</button>
        </div>
      )}

      {loading && <div style={{ color: 'var(--faint)', fontSize: 12 }}>Loading…</div>}
      {error && <div style={{ color: 'var(--alert)', fontSize: 12 }}>{error}</div>}

      {useGroups && (
        <input
          className={styles.gsearch}
          value={genreQuery}
          onChange={(ev) => setGenreQuery(ev.target.value)}
          placeholder="Search genres…"
        />
      )}

      {useGroups ? renderGenreGroups() : entries.map(renderEntry)}
    </div>
  );
}

