import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useStore, type LibraryEntry, type BookManifest } from '@bookclaw/shared';
import { FormatPicker, EMPTY_FORMAT, formatFit, parseCustomStructure, type FormatValue, type StructureOpt, type FormOpt } from '../components/newbook/FormatPicker.js';
import styles from './AdaptiveInterview.module.css';

// Response shape of POST /api/romance/interview (backend: romance-interview.ts).
type Heat = 'sweet' | 'spicy';
type CouncilSelection = 'auto' | 'propose';
interface InterviewSeeds {
  heat: Heat;
  storyArc: string;
  characters: string;
  setting: string;
  chapterCount: number;
  wordsPerChapter: number;
  councilSelection: CouncilSelection;
}
interface ChatMessage { role: 'user' | 'assistant'; content: string; }
interface TurnResult { reply: string; done: boolean; seeds?: InterviewSeeds; }

type EditableSeedField = 'storyArc' | 'characters' | 'setting';

export function AdaptiveInterview() {
  const navigate = useNavigate();
  const loadBooks = useStore((s) => s.loadBooks);

  // Chat stage. `seeds` doubles as the stage switch: null = chat, set = review.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [seeds, setSeeds] = useState<InterviewSeeds | null>(null);

  // Book identity (review stage) — not part of the interview contract.
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState<LibraryEntry[]>([]);
  const [voices, setVoices] = useState<LibraryEntry[]>([]);
  const [genres, setGenres] = useState<LibraryEntry[]>([]);
  const [author, setAuthor] = useState('');
  const [voice, setVoice] = useState('');
  const [genre, setGenre] = useState('');

  const [structuresOpts, setStructuresOpts] = useState<StructureOpt[]>([]);
  const [formsOpts, setFormsOpts] = useState<FormOpt[]>([]);
  const [format, setFormat] = useState<FormatValue>(EMPTY_FORMAT);

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

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

  // One interview turn: append the user's text (if any), post the whole transcript,
  // append the assistant's reply. Called with '' for the opening turn (mount effect).
  const send = async (userText: string) => {
    const next = userText ? [...messages, { role: 'user' as const, content: userText }] : messages;
    setMessages(next); setInput(''); setPending(true); setError(null);
    try {
      const r = await api<TurnResult>('/api/romance/interview', { method: 'POST', body: JSON.stringify({ messages: next }) });
      setMessages((m) => [...m, { role: 'assistant', content: r.reply }]);
      if (r.done && r.seeds) {
        setSeeds(r.seeds);
        setFormat((f) => ({ ...f, chapterCount: r.seeds!.chapterCount, wordsPerChapter: r.seeds!.wordsPerChapter }));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setPending(false);
    }
  };

  // Fire the opening turn once. The ref guard prevents React 18 StrictMode's dev
  // double-effect-invoke from firing a duplicate (paid) editor_chat turn + a
  // duplicate greeting bubble.
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    void send('');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const text = input.trim();
    if (!text || pending) return;
    void send(text);
  };

  const editSeed = <K extends keyof InterviewSeeds>(key: K, value: InterviewSeeds[K]) =>
    setSeeds((s) => (s ? { ...s, [key]: value } : s));

  const fit = formatFit(format, formsOpts);
  // Require an active AND fitting format (mirrors Guided's guidedCanCreate): formatFit
  // returns ok:true when nothing is picked, so without fit.active a 0/0-count interview
  // reply could enable Start Book with no structure/form → a 400 from buildBookFormat.
  const canCreate = !!(seeds && title.trim() && author && voice) && fit.active && fit.ok && !creating;

  const startBook = async () => {
    if (!seeds) return;
    setCreating(true); setCreateError(null);
    try {
      await api<{ book: BookManifest }>('/api/books', { method: 'POST', body: JSON.stringify({
        title: title.trim(),
        author,
        voice,
        genre: genre || null,
        pipelineSequence: [seeds.heat === 'spicy' ? 'romance-spicy-deterministic' : 'romance-sweet-deterministic'],
        storyArc: seeds.storyArc,
        characters: seeds.characters,
        setting: seeds.setting,
        councilSelection: seeds.councilSelection,
        structure: format.structure,
        ...(format.structure === 'custom' ? { customStructure: parseCustomStructure(format.customStructureText) } : {}),
        form: format.form,
        chapterCount: format.chapterCount,
        wordsPerChapter: format.wordsPerChapter,
      }) });
      await loadBooks();
      navigate('/');
    } catch (e) {
      setCreateError(String(e));
    } finally {
      setCreating(false);
    }
  };

  // ---- Chat stage ----
  if (!seeds) {
    return (
      <div className={styles.body}>
        <div className={styles.wrap}>
          <div className={styles.hero}>
            <h1>Adaptive <em>interview</em></h1>
            <p>Answer a few questions and BookClaw draws your romance story out of the conversation, then hands it back to you for review.</p>
          </div>

          <div className={styles.transcript}>
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}>{m.content}</div>
            ))}
            {pending && <div className={styles.bubbleAssistant}>…</div>}
          </div>

          {error && <p className={styles.err}>Couldn't send — {error}</p>}

          <div className={styles.composer}>
            <textarea className={styles.area} rows={3} value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder="Tell me about the story you want to write…" disabled={pending} />
            <button className={styles.primary} onClick={submit} disabled={pending || !input.trim()}>
              {pending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Review stage ----
  const field = (key: EditableSeedField, label: string, rows: number) => (
    <div className={styles.idblock}>
      <div className={styles.fl}>{label}</div>
      <textarea className={styles.area} rows={rows} value={seeds[key]}
        onChange={(e) => editSeed(key, e.target.value)} />
    </div>
  );

  return (
    <div className={styles.body}>
      <div className={styles.wrap}>
        <div className={styles.hero}>
          <h1>Review the <em>seeds</em></h1>
          <p>Everything below is editable. Set a title, author, and voice, and pick a format that fits, then start the book.</p>
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

        {field('storyArc', 'Story arc', 5)}
        {field('characters', 'Characters', 6)}
        {field('setting', 'Setting', 6)}

        <div className={styles.idblock}>
          <div className={styles.fl}>Council selection</div>
          <div className={styles.toggle}>
            <button type="button" className={seeds.councilSelection === 'auto' ? styles.togSel : styles.togBtn}
              onClick={() => editSeed('councilSelection', 'auto')}>Auto-Select Best Story</button>
            <button type="button" className={seeds.councilSelection === 'propose' ? styles.togSel : styles.togBtn}
              onClick={() => editSeed('councilSelection', 'propose')}>Propose Top Ideas</button>
          </div>
        </div>

        <FormatPicker structures={structuresOpts} forms={formsOpts} value={format} onChange={setFormat} />

        {createError && <p className={styles.err}>Couldn't create — {createError}</p>}
        <button className={styles.primary} onClick={startBook} disabled={!canCreate}>
          {creating ? 'Starting…' : 'Start Book'}
        </button>
        {!canCreate && !creating && (
          <p className={styles.hint}>Set a title, author, and voice, and pick a structure/form/chapter-count/words-per-chapter that fits, to start.</p>
        )}
      </div>
    </div>
  );
}
