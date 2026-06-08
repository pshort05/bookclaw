import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useStore, type LibraryEntry, type LibraryKind, type LibraryEntryFull, type BookManifest } from '@bookclaw/shared';
import { GLOSSARY } from '../lib/glossary.js';
import { OptionCard } from '../components/newbook/OptionCard.js';
import { SnapshotSummary } from '../components/newbook/SnapshotSummary.js';
import styles from './NewBook.module.css';

export function NewBook() {
  const navigate = useNavigate();
  const loadBooks = useStore((s) => s.loadBooks);
  const [opts, setOpts] = useState<Partial<Record<LibraryKind, LibraryEntry[]>>>({});
  const [title, setTitle] = useState('');
  const [sel, setSel] = useState<Record<LibraryKind, string>>({ author: '', voice: '', genre: '', pipeline: '', section: '', skill: '' } as Record<LibraryKind, string>);
  const [sections, setSections] = useState<string[]>([]);
  const [pipelineSkills, setPipelineSkills] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all((['author', 'voice', 'genre', 'pipeline', 'section'] as LibraryKind[]).map((k) =>
      api<{ entries: LibraryEntry[] }>(`/api/library/${k}`).then((r) => [k, r.entries ?? []] as const).catch(() => [k, []] as const),
    )).then((pairs) => {
      const map = Object.fromEntries(pairs) as Partial<Record<LibraryKind, LibraryEntry[]>>;
      setOpts(map);
      setSel((s) => ({
        ...s,
        author: s.author || (map.author?.[0]?.name ?? ''),
        voice: s.voice || (map.voice?.[0]?.name ?? ''),
        pipeline: s.pipeline || (map.pipeline?.[0]?.name ?? ''),
      }));
    }).catch((e) => setError(String(e)));
  }, []);

  // When the pipeline changes, fetch the skills it references (read-only, derived).
  useEffect(() => {
    if (!sel.pipeline) { setPipelineSkills([]); return; }
    let cancelled = false;
    api<{ entry: LibraryEntryFull }>(`/api/library/pipeline/${encodeURIComponent(sel.pipeline)}`)
      .then((r) => { if (!cancelled) setPipelineSkills([...new Set((r.entry.pipeline?.steps ?? []).map((st) => st.skill).filter((x): x is string => !!x))]); })
      .catch(() => { if (!cancelled) setPipelineSkills([]); });
    return () => { cancelled = true; };
  }, [sel.pipeline]);

  // genre is deselectable (optional); all other single-kinds must stay selected once picked
  const pickSingle = (kind: LibraryKind, name: string) =>
    setSel((s) => ({ ...s, [kind]: s[kind] === name && kind === 'genre' ? '' : name }));

  const toggleSection = (name: string) =>
    setSections((xs) => xs.includes(name) ? xs.filter((n) => n !== name) : [...xs, name]);

  const canCreate = !!(title.trim() && sel.author && sel.voice && sel.pipeline) && !busy;

  const create = async () => {
    setBusy(true); setError(null);
    try {
      await api<{ book: BookManifest }>('/api/books', { method: 'POST', body: JSON.stringify({
        title: title.trim(), author: sel.author, voice: sel.voice, genre: sel.genre || null, pipeline: sel.pipeline, sections,
      }) });
      await loadBooks();
      navigate('/');
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  const pick = (kind: LibraryKind) => {
    const g = GLOSSARY[kind];
    const entries = opts[kind] ?? [];
    return (
      <section className={styles.pick} key={kind}>
        <div className={styles.ph}>
          <h3>
            {g.canon}
            {kind === 'genre' && <span className={styles.pickone}> · optional</span>}
            {kind === 'section' && <span className={styles.pickone}> · choose any</span>}
          </h3>
          <span className={styles.canon}>term · {g.canon}</span>
        </div>
        <div className={styles.def}>{g.def}</div>
        <div className={styles.grid2}>
          {entries.map((e) => (
            <OptionCard
              key={e.name}
              entry={e}
              mode={kind === 'section' ? 'multi' : 'single'}
              selected={kind === 'section' ? sections.includes(e.name) : sel[kind] === e.name}
              onToggle={() => kind === 'section' ? toggleSection(e.name) : pickSingle(kind, e.name)}
            />
          ))}
          {entries.length === 0 && <p className={styles.def}>None in the library yet.</p>}
        </div>
      </section>
    );
  };

  return (
    <div className={styles.body}>
      <div className={styles.wrap}>
        <div>
          <div className={styles.hero}>
            <h1>New <em>book</em></h1>
            <p>Pull templates from the library; a frozen copy is snapshotted into the book.</p>
          </div>
          <div className={styles.idblock}>
            <div className={styles.fl}>Title</div>
            <input className={styles.tin} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The Dragon's Heir" />
          </div>
          {pick('author')}
          {pick('voice')}
          {pick('genre')}
          {pick('pipeline')}
          {pick('section')}
          {error && <p className={styles.def} style={{ color: 'var(--alert)' }}>Couldn't create — {error}</p>}
        </div>
        <SnapshotSummary
          title={title}
          author={sel.author}
          voice={sel.voice}
          genre={sel.genre || null}
          pipeline={sel.pipeline}
          sectionCount={sections.length}
          skills={pipelineSkills}
          canCreate={canCreate}
          busy={busy}
          onCreate={create}
        />
      </div>
    </div>
  );
}
