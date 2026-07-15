import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useStore, type LibraryEntry, type BookManifest } from '@bookclaw/shared';
import { FormatPicker, EMPTY_FORMAT, formatFit, parseCustomStructure, type FormatValue, type StructureOpt, type FormOpt } from '../components/newbook/FormatPicker.js';
import { guidedCanCreate, buildGuidedCreatePayload, EMPTY_GUIDED_SEEDS, type GuidedSeeds } from '../lib/guidedSeeds.js';
import styles from './Guided.module.css';

export function Guided() {
  const navigate = useNavigate();
  const loadBooks = useStore((s) => s.loadBooks);

  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState<LibraryEntry[]>([]);
  const [voices, setVoices] = useState<LibraryEntry[]>([]);
  const [genres, setGenres] = useState<LibraryEntry[]>([]);
  const [author, setAuthor] = useState('');
  const [voice, setVoice] = useState('');
  const [genre, setGenre] = useState('');

  const [seeds, setSeeds] = useState<GuidedSeeds>(EMPTY_GUIDED_SEEDS);
  const [structuresOpts, setStructuresOpts] = useState<StructureOpt[]>([]);
  const [formsOpts, setFormsOpts] = useState<FormOpt[]>([]);
  const [format, setFormat] = useState<FormatValue>(EMPTY_FORMAT);

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = (kind: string) =>
      api<{ entries: LibraryEntry[] }>(`/api/library/${kind}`).then((r) => r.entries ?? []).catch(() => []);
    load('author').then((e) => setAuthors(e));
    load('voice').then((e) => setVoices(e));
    load('genre').then((e) => {
      setGenres(e);
      setGenre((g) => g || (e.find((x) => x.name === 'romance')?.name ?? ''));
    });
    api<{ structures: StructureOpt[] }>('/api/structures').then((r) => setStructuresOpts(r.structures ?? [])).catch(() => {});
    api<{ forms: FormOpt[] }>('/api/forms').then((r) => setFormsOpts(r.forms ?? [])).catch(() => {});
  }, []);

  const editSeed = <K extends keyof GuidedSeeds>(key: K, value: GuidedSeeds[K]) =>
    setSeeds((s) => ({ ...s, [key]: value }));

  const fit = formatFit(format, formsOpts);
  const canCreate = guidedCanCreate({ title, author, voice, formatOk: fit.ok, formatActive: fit.active }) && !creating;

  const create = async () => {
    setCreating(true); setError(null);
    try {
      const payload = buildGuidedCreatePayload({
        title, author, voice, genre, seeds,
        format: {
          structure: format.structure,
          ...(format.structure === 'custom' ? { customStructure: parseCustomStructure(format.customStructureText) } : {}),
          form: format.form,
          chapterCount: format.chapterCount,
          wordsPerChapter: format.wordsPerChapter,
        },
      });
      await api<{ book: BookManifest }>('/api/books', { method: 'POST', body: JSON.stringify(payload) });
      await loadBooks();
      navigate('/');
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className={styles.body}>
      <div className={styles.wrap}>
        <div className={styles.hero}>
          <h1>Guided <em>romance</em> wizard</h1>
          <p>Fill in the shared seed contract — arc, characters, setting, heat and format — and BookClaw develops it into a full romance novel. No AI is called until you start the book.</p>
        </div>

        <div className={styles.idblock}>
          <div className={styles.fl}>Title</div>
          <input className={styles.tin} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name your book" />
        </div>
        <div className={styles.row}>
          <div className={styles.idblock}>
            <div className={styles.fl}>Author</div>
            <select className={styles.tin} value={author} onChange={(e) => setAuthor(e.target.value)}>
              <option value="" disabled>Choose an author…</option>
              {authors.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </div>
          <div className={styles.idblock}>
            <div className={styles.fl}>Voice</div>
            <select className={styles.tin} value={voice} onChange={(e) => setVoice(e.target.value)}>
              <option value="" disabled>Choose a voice…</option>
              {voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </div>
          <div className={styles.idblock}>
            <div className={styles.fl}>Genre</div>
            <select className={styles.tin} value={genre} onChange={(e) => setGenre(e.target.value)}>
              <option value="">— none —</option>
              {genres.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
            </select>
          </div>
        </div>

        <div className={styles.idblock}>
          <div className={styles.fl}>Heat</div>
          <div className={styles.toggle}>
            <button type="button" className={seeds.heat === 'sweet' ? styles.togSel : styles.togBtn}
              onClick={() => editSeed('heat', 'sweet')}>Sweet</button>
            <button type="button" className={seeds.heat === 'spicy' ? styles.togSel : styles.togBtn}
              onClick={() => editSeed('heat', 'spicy')}>Spicy</button>
          </div>
        </div>

        <div className={styles.idblock}>
          <div className={styles.fl}>Story arc</div>
          <textarea className={styles.area} rows={5} value={seeds.storyArc}
            onChange={(e) => editSeed('storyArc', e.target.value)}
            placeholder="A second-chance romance between a chef and the critic who once panned her restaurant." />
        </div>
        <div className={styles.idblock}>
          <div className={styles.fl}>Characters</div>
          <textarea className={styles.area} rows={6} value={seeds.characters}
            onChange={(e) => editSeed('characters', e.target.value)}
            placeholder="Names, ages, jobs, wounds, supporting cast." />
        </div>
        <div className={styles.idblock}>
          <div className={styles.fl}>Setting</div>
          <textarea className={styles.area} rows={6} value={seeds.setting}
            onChange={(e) => editSeed('setting', e.target.value)}
            placeholder="Place, season, sensory texture — real-world locations and businesses." />
        </div>

        <div className={styles.idblock}>
          <div className={styles.fl}>Council selection</div>
          <div className={styles.toggle}>
            <button type="button" className={seeds.councilSelection === 'auto' ? styles.togSel : styles.togBtn}
              onClick={() => editSeed('councilSelection', 'auto')}>Auto-select the best base story</button>
            <button type="button" className={seeds.councilSelection === 'propose' ? styles.togSel : styles.togBtn}
              onClick={() => editSeed('councilSelection', 'propose')}>Propose top ideas for me to pick</button>
          </div>
        </div>

        <FormatPicker structures={structuresOpts} forms={formsOpts} value={format} onChange={setFormat} />

        {error && <p className={styles.err}>Couldn't create — {error}</p>}
        <button className={styles.primary} onClick={create} disabled={!canCreate}>
          {creating ? 'Starting…' : 'Start Book'}
        </button>
        {!canCreate && !creating && (
          <p className={styles.hint}>Set a title, author, and voice, and pick a structure/form/chapter-count/words-per-chapter that fits, to start.</p>
        )}
      </div>
    </div>
  );
}
