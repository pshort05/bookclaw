import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useStore, Button, type LibraryEntry, type LibraryKind, type BookManifest } from '@bookclaw/shared';
import styles from './NewBook.module.css';

const KINDS: LibraryKind[] = ['author', 'voice', 'genre', 'pipeline'];

export function NewBook() {
  const navigate = useNavigate();
  const loadBooks = useStore((s) => s.loadBooks);
  const [opts, setOpts] = useState<Record<string, LibraryEntry[]>>({});
  const [title, setTitle] = useState('');
  const [sel, setSel] = useState<Record<LibraryKind, string>>({ author: '', voice: '', genre: '', pipeline: '' } as Record<LibraryKind, string>);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all(KINDS.map((k) =>
      api<{ entries: LibraryEntry[] }>(`/api/library/${k}`).then((r) => [k, r.entries ?? []] as const),
    )).then((pairs) => {
      const map = Object.fromEntries(pairs) as Record<string, LibraryEntry[]>;
      setOpts(map);
      // Pre-select the first option for each required kind.
      setSel((s) => ({
        ...s,
        author: map.author?.[0]?.name ?? '',
        voice: map.voice?.[0]?.name ?? '',
        pipeline: map.pipeline?.[0]?.name ?? '',
      }));
    }).catch((e) => setError(String(e)));
  }, []);

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const body = JSON.stringify({
        title: title.trim(),
        author: sel.author,
        voice: sel.voice,
        genre: sel.genre || null,
        pipeline: sel.pipeline,
        sections: [],
      });
      await api<{ success: boolean; book: BookManifest }>('/api/books', { method: 'POST', body });
      await loadBooks();
      navigate('/');
    } catch (e) {
      setError(String(e));
    } finally { setBusy(false); }
  };

  const canCreate = title.trim() && sel.author && sel.voice && sel.pipeline && !busy;

  const field = (k: LibraryKind, label: string, optional = false) => (
    <div className={styles.field} key={k}>
      <label className={styles.fl}>{label}{optional && <em> (optional)</em>}</label>
      <select value={sel[k]} onChange={(e) => setSel((s) => ({ ...s, [k]: e.target.value }))}>
        {optional && <option value="">— none —</option>}
        {(opts[k] ?? []).map((o) => (
          <option key={o.name} value={o.name}>{o.name}{o.source !== 'builtin' ? ' (yours)' : ''}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.hero}>
        <h1>New <em>book</em></h1>
        <p>A copy of these library templates is frozen into the book at creation. The full picker arrives in a later update.</p>
      </div>

      <div className={styles.field}>
        <label className={styles.fl}>Title</label>
        <input className={styles.tin} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Dragon's Heir" />
      </div>

      {field('author', 'Author')}
      {field('voice', 'Voice')}
      {field('genre', 'Genre', true)}
      {field('pipeline', 'Pipeline')}

      {error && <p className={styles.err}>Couldn't create — {error}</p>}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => navigate('/')}>Cancel</Button>
        <Button variant="primary" onClick={create} disabled={!canCreate}>{busy ? 'Creating…' : 'Create book'}</Button>
      </div>
    </div>
  );
}
