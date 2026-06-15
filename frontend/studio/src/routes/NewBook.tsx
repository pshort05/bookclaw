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
  const [sel, setSel] = useState<Record<LibraryKind, string>>({ author: '', voice: '', genre: '', pipeline: '', sequence: '', section: '', skill: '', editor: '' } as Record<LibraryKind, string>);
  const [sections, setSections] = useState<string[]>([]);
  const [pipelineSkills, setPipelineSkills] = useState<string[]>([]);
  // The composed, editable ordered list of pipeline names this book will run.
  const [pipelineSeq, setPipelineSeq] = useState<string[]>([]);
  const [seqPreset, setSeqPreset] = useState('');
  const [seqAddPick, setSeqAddPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  type SeriesOpt = { id: string; title: string; pulledFrom: { author?: { name: string }; voice?: { name: string }; genre?: { name: string } | null; pipeline?: { name: string } | null } };
  const [seriesList, setSeriesList] = useState<SeriesOpt[]>([]);
  const [seriesId, setSeriesId] = useState('');

  useEffect(() => {
    api<{ series: SeriesOpt[] }>('/api/series').then((r) => setSeriesList(r.series ?? [])).catch(() => {});
  }, []);

  // Choosing a series reflects its shared assets into the pickers (server is
  // authoritative — it inherits author/voice/genre + world-building from the series).
  const chooseSeries = (id: string) => {
    setSeriesId(id);
    const s = seriesList.find((x) => x.id === id);
    if (s) setSel((prev) => ({
      ...prev,
      author: s.pulledFrom.author?.name ?? prev.author,
      voice: s.pulledFrom.voice?.name ?? prev.voice,
      genre: s.pulledFrom.genre?.name ?? prev.genre,
    }));
  };

  useEffect(() => {
    Promise.all((['author', 'voice', 'genre', 'pipeline', 'sequence', 'section'] as LibraryKind[]).map((k) =>
      api<{ entries: LibraryEntry[] }>(`/api/library/${k}`).then((r) => [k, r.entries ?? []] as const).catch(() => [k, []] as const),
    )).then((pairs) => {
      const map = Object.fromEntries(pairs) as Partial<Record<LibraryKind, LibraryEntry[]>>;
      setOpts(map);
      setSel((s) => ({
        ...s,
        author: s.author || (map.author?.[0]?.name ?? ''),
        voice: s.voice || (map.voice?.[0]?.name ?? ''),
      }));
      // Seed the pipeline sequence from the `novel` preset (or the first one available).
      const seqs = map.sequence ?? [];
      const preset = seqs.find((e) => e.name === 'novel') ?? seqs[0];
      if (preset) seedSequence(preset.name);
    }).catch((e) => setError(String(e)));
  }, []);

  // Load a sequence preset's ordered pipeline list into the editable list.
  const seedSequence = (presetName: string) => {
    setSeqPreset(presetName);
    if (!presetName) { setPipelineSeq([]); return; }
    api<{ entry: LibraryEntryFull & { sequence?: { pipelines?: string[] } } }>(`/api/library/sequence/${encodeURIComponent(presetName)}`)
      .then((r) => {
        let names: string[] = [];
        const e = r.entry as { sequence?: { pipelines?: string[] }; content?: string };
        if (e.sequence?.pipelines) names = e.sequence.pipelines;
        else if (typeof e.content === 'string') { try { names = JSON.parse(e.content).pipelines ?? []; } catch { /* ignore */ } }
        setPipelineSeq(names.filter((n) => typeof n === 'string'));
      })
      .catch(() => setPipelineSeq([]));
  };

  // Derive the skills referenced across every pipeline in the sequence (read-only preview).
  useEffect(() => {
    if (pipelineSeq.length === 0) { setPipelineSkills([]); return; }
    let cancelled = false;
    Promise.all(pipelineSeq.map((p) =>
      api<{ entry: LibraryEntryFull }>(`/api/library/pipeline/${encodeURIComponent(p)}`)
        .then((r) => (r.entry.pipeline?.steps ?? []).map((st) => st.skill).filter((x): x is string => !!x))
        .catch(() => [] as string[]),
    )).then((lists) => { if (!cancelled) setPipelineSkills([...new Set(lists.flat())]); });
    return () => { cancelled = true; };
  }, [pipelineSeq]);

  // genre is deselectable (optional); all other single-kinds must stay selected once picked.
  // When a series is chosen, author/voice/genre come FROM the series (server-authoritative),
  // so those pickers are locked to keep the preview honest.
  const pickSingle = (kind: LibraryKind, name: string) => {
    if (seriesId && (kind === 'author' || kind === 'voice' || kind === 'genre')) return;
    setSel((s) => ({ ...s, [kind]: s[kind] === name && kind === 'genre' ? '' : name }));
  };

  const toggleSection = (name: string) =>
    setSections((xs) => xs.includes(name) ? xs.filter((n) => n !== name) : [...xs, name]);

  const moveSeq = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= pipelineSeq.length) return;
    setPipelineSeq((xs) => { const n = [...xs]; [n[i], n[j]] = [n[j], n[i]]; return n; });
  };
  const removeSeq = (i: number) => setPipelineSeq((xs) => xs.filter((_, idx) => idx !== i));
  const addSeq = () => { if (!seqAddPick) return; setPipelineSeq((xs) => [...xs, seqAddPick]); setSeqAddPick(''); };

  const canCreate = !!(title.trim() && sel.author && sel.voice && pipelineSeq.length > 0) && !busy;

  const create = async () => {
    setBusy(true); setError(null);
    try {
      await api<{ book: BookManifest }>('/api/books', { method: 'POST', body: JSON.stringify({
        title: title.trim(), author: sel.author, voice: sel.voice, genre: sel.genre || null,
        pipelineSequence: pipelineSeq,
        ...(seqPreset ? { sequence: seqPreset } : {}),
        sections,
        ...(seriesId ? { series: seriesId } : {}),
      }) });
      await loadBooks();
      navigate('/');
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };

  const pick = (kind: LibraryKind) => {
    const g = GLOSSARY[kind];
    const entries = opts[kind] ?? [];
    const locked = !!seriesId && (kind === 'author' || kind === 'voice' || kind === 'genre');
    return (
      <section className={styles.pick} key={kind}>
        <div className={styles.ph}>
          <h3>
            {g.canon}
            {kind === 'genre' && <span className={styles.pickone}> · optional</span>}
            {kind === 'section' && <span className={styles.pickone}> · choose any</span>}
            {locked && <span className={styles.pickone}> · from series</span>}
          </h3>
          <span className={styles.canon}>term · {g.canon}</span>
        </div>
        <div className={styles.def}>{g.def}</div>
        <div className={locked ? `${styles.grid2} ${styles.locked}` : styles.grid2}>
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

  const availablePipelines = (opts.pipeline ?? []).map((e) => e.name);

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
          {seriesList.length > 0 && (
            <div className={styles.idblock}>
              <div className={styles.fl}>Series <span className={styles.pickone}>· optional — inherits author, voice, genre &amp; world-building</span></div>
              <select className={styles.tin} value={seriesId} onChange={(e) => chooseSeries(e.target.value)}>
                <option value="">— none (standalone) —</option>
                {seriesList.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </div>
          )}
          {pick('author')}
          {pick('voice')}
          {pick('genre')}

          {/* Sequence: pick a preset, then edit the ordered pipeline list. */}
          <section className={styles.pick}>
            <div className={styles.ph}>
              <h3>{GLOSSARY.sequence.canon}</h3>
              <span className={styles.canon}>term · {GLOSSARY.sequence.canon}</span>
            </div>
            <div className={styles.def}>{GLOSSARY.sequence.def}</div>
            <div className={styles.idblock} style={{ marginTop: 0 }}>
              <div className={styles.fl}>Preset</div>
              <select className={styles.tin} value={seqPreset} onChange={(e) => seedSequence(e.target.value)}>
                <option value="">— custom (no preset) —</option>
                {(opts.sequence ?? []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            </div>
            <div style={{ marginTop: 12 }}>
              {pipelineSeq.map((p, i) => (
                <div key={`${p}-${i}`} className={styles.seqrow}>
                  <span className={styles.seqnum}>{i + 1}</span>
                  <span className={styles.seqname}>{p}</span>
                  <span className={styles.seqctrl}>
                    <button onClick={() => moveSeq(i, -1)} disabled={i === 0} title="Move up">↑</button>
                    <button onClick={() => moveSeq(i, 1)} disabled={i === pipelineSeq.length - 1} title="Move down">↓</button>
                    <button onClick={() => removeSeq(i)} title="Remove">×</button>
                  </span>
                </div>
              ))}
              {pipelineSeq.length === 0 && <p className={styles.def}>No pipelines yet — add one below.</p>}
              <div className={styles.seqadd}>
                <select className={styles.tin} value={seqAddPick} onChange={(e) => setSeqAddPick(e.target.value)}>
                  <option value="">— add a pipeline —</option>
                  {availablePipelines.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <button onClick={addSeq} disabled={!seqAddPick}>Add</button>
              </div>
            </div>
          </section>

          {pick('section')}
          {error && <p className={styles.def} style={{ color: 'var(--alert)' }}>Couldn't create — {error}</p>}
        </div>
        <SnapshotSummary
          title={title}
          author={sel.author}
          voice={sel.voice}
          genre={sel.genre || null}
          pipeline={pipelineSeq.length ? pipelineSeq.join(' → ') : undefined}
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
