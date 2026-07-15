import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useStore, type LibraryEntry, type BookManifest } from '@bookclaw/shared';
import styles from './PremiseIntake.module.css';

// Response shape of POST /api/books/intake (backend: books.routes.ts).
type Heat = 'sweet' | 'spicy';
type TextSeedField = 'storyArc' | 'characters' | 'setting' | 'blueprint';
type SeedField = TextSeedField | 'heat' | 'chapterCount' | 'wordsPerChapter';
interface Seeds {
  storyArc: string; characters: string; setting: string; blueprint: string;
  heat: Heat; chapterCount: number; wordsPerChapter: number;
}
interface Gap { id: string; question: string; proposedAnswer: string; alternatives?: string[]; targetField: SeedField; }
interface Discrepancy {
  id: string; premiseClaim: string; finding: string; status: 'pass' | 'fail';
  suggestion?: string; targetField: 'setting' | 'blueprint' | 'characters';
}
interface IntakeResult {
  seeds: Seeds;
  gaps: Gap[];
  discrepancies: Discrepancy[];
  realPlace: { isReal: boolean; canonicalName?: string };
  groundingStatus: 'grounded' | 'fallback-llm' | 'skipped';
}

const TEXT_FIELDS: TextSeedField[] = ['storyArc', 'characters', 'setting', 'blueprint'];
const isTextField = (f: SeedField): f is TextSeedField => (TEXT_FIELDS as SeedField[]).includes(f);

// Real backend stages of POST /api/books/intake (parse → research → grounding).
// Time-based advance (the request is a single blocking call), capped at the last.
const ANALYZE_STAGES = [
  'Parsing the premise into structured seeds…',
  'Researching the real-world location…',
  'Building the setting dossier & fact-checking…',
];
const stageForElapsed = (s: number) => (s < 45 ? 0 : s < 100 ? 1 : 2);

export function PremiseIntake() {
  const navigate = useNavigate();
  const loadBooks = useStore((s) => s.loadBooks);

  // Input stage.
  const [premise, setPremise] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // While the (long, single-request) analysis runs, tick an elapsed timer and
  // advance through the real backend stages so the user sees progress.
  useEffect(() => {
    if (!analyzing) { setElapsed(0); return; }
    const start = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [analyzing]);

  // Review stage.
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [seeds, setSeeds] = useState<Seeds | null>(null);
  // Heat is only ever an LLM *guess* (the premise rarely declares it) and the guess
  // flips run-to-run, so it must not silently pick the pipeline. Require an explicit
  // Sweet/Spicy confirmation before the book can be created.
  const [heatConfirmed, setHeatConfirmed] = useState(false);
  const [gapAnswers, setGapAnswers] = useState<Record<string, string>>({});
  // Only failed discrepancies need a decision: 'applied' (take the suggestion) or 'kept' (intentional).
  const [discResolution, setDiscResolution] = useState<Record<string, 'applied' | 'kept'>>({});

  // Book identity (not in the intake response — author/voice are required library entries).
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState<LibraryEntry[]>([]);
  const [voices, setVoices] = useState<LibraryEntry[]>([]);
  const [genres, setGenres] = useState<LibraryEntry[]>([]);
  const [author, setAuthor] = useState('');
  const [voice, setVoice] = useState('');
  const [genre, setGenre] = useState('');

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const load = (kind: string) =>
      api<{ entries: LibraryEntry[] }>(`/api/library/${kind}`).then((r) => r.entries ?? []).catch(() => []);
    load('author').then((e) => { setAuthors(e); setAuthor((a) => a || (e[0]?.name ?? '')); });
    load('voice').then((e) => { setVoices(e); setVoice((v) => v || (e[0]?.name ?? '')); });
    load('genre').then((e) => {
      setGenres(e);
      setGenre((g) => g || (e.find((x) => x.name === 'romance')?.name ?? ''));
    });
  }, []);

  const fillFromFile = async (file: File | undefined) => {
    if (!file) return;
    setPremise(await file.text());
  };

  const analyze = async () => {
    const text = premise.trim();
    if (!text) { setAnalyzeError('Paste or upload a premise document first.'); return; }
    setAnalyzing(true); setAnalyzeError(null);
    try {
      const r = await api<IntakeResult>('/api/books/intake', { method: 'POST', body: JSON.stringify({ premise: text }) });
      setResult(r);
      setSeeds(r.seeds);
      setHeatConfirmed(false); // force an explicit re-confirm of the LLM's heat guess
      setGapAnswers(Object.fromEntries(r.gaps.map((g) => [g.id, g.proposedAnswer ?? ''])));
      setDiscResolution({});
    } catch (e) {
      setAnalyzeError(String(e));
    } finally {
      setAnalyzing(false);
    }
  };

  const editSeed = <K extends keyof Seeds>(key: K, value: Seeds[K]) =>
    setSeeds((s) => (s ? { ...s, [key]: value } : s));

  // "Apply" a discrepancy suggestion: just record the decision. The actual splice
  // happens once at finalize time (see startBook) so re-clicking stays idempotent.
  const applyDiscrepancy = (d: Discrepancy) => setDiscResolution((m) => ({ ...m, [d.id]: 'applied' }));
  const keepDiscrepancy = (d: Discrepancy) => setDiscResolution((m) => ({ ...m, [d.id]: 'kept' }));

  const failDiscs = (result?.discrepancies ?? []).filter((d) => d.status === 'fail');
  const passDiscs = (result?.discrepancies ?? []).filter((d) => d.status === 'pass');
  const gaps = result?.gaps ?? [];

  const gapsResolved = gaps.every((g) => (gapAnswers[g.id] ?? '').trim().length > 0);
  const discsResolved = failDiscs.every((d) => !!discResolution[d.id]);
  const canCreate = !!(seeds && title.trim() && author && voice && gapsResolved && discsResolved && heatConfirmed && !creating);

  const startBook = async () => {
    if (!seeds || !result) return;
    setCreating(true); setCreateError(null);
    try {
      // Deterministically splice resolved answers into their seed fields. No AI call.
      const final: Seeds = { ...seeds };
      // Discrepancy suggestions: splice once here for every 'applied' fail-discrepancy.
      // 'kept' means the author accepted the premise claim as intentional — nothing to do.
      for (const d of failDiscs) {
        if (discResolution[d.id] !== 'applied' || !d.suggestion) continue;
        final[d.targetField] = `${final[d.targetField]}\n\n[Fact-check: ${d.premiseClaim}] ${d.suggestion}`;
      }
      // Gap answers: append to the named text field, or fold into the blueprint when the
      // gap targets a non-text field (heat/chapterCount/wordsPerChapter carry no prose slot).
      for (const g of gaps) {
        const ans = (gapAnswers[g.id] ?? '').trim();
        if (!ans) continue;
        const field: TextSeedField = isTextField(g.targetField) ? g.targetField : 'blueprint';
        final[field] = `${final[field]}\n\n[${g.question}] ${ans}`;
      }
      // Length target: the /api/books format block requires a structure+form pair the
      // intake never produces, so send the target as a blueprint annotation instead —
      // this is the field the outline prompt reads.
      final.blueprint = `${final.blueprint}\n\n[Target length] ${seeds.chapterCount} chapters of ~${seeds.wordsPerChapter} words each.`;

      await api<{ book: BookManifest }>('/api/books', { method: 'POST', body: JSON.stringify({
        title: title.trim(),
        author,
        voice,
        genre: genre || null,
        pipelineSequence: [seeds.heat === 'spicy' ? 'romance-spicy-deterministic' : 'romance-sweet-deterministic'],
        storyArc: final.storyArc,
        characters: final.characters,
        setting: final.setting,
        blueprint: final.blueprint,
      }) });
      await loadBooks();
      navigate('/');
    } catch (e) {
      setCreateError(String(e));
    } finally {
      setCreating(false);
    }
  };

  // ---- Input stage ----
  if (!result || !seeds) {
    return (
      <div className={styles.body}>
        <div className={styles.wrap}>
          <div className={styles.hero}>
            <h1>From <em>premise</em> file</h1>
            <p>Paste or upload a free-form premise document. BookClaw reads it into editable seeds, grounds the setting against real geography, and fact-checks its claims before you start the book.</p>
          </div>
          <div className={styles.idblock}>
            <div className={styles.fl}>Premise document (.md)</div>
            <input type="file" accept=".md,.markdown,.txt" className={styles.file}
              onChange={(e) => fillFromFile(e.target.files?.[0])} />
          </div>
          <div className={styles.idblock}>
            <div className={styles.fl}>Premise text</div>
            <textarea className={styles.area} rows={16} value={premise}
              onChange={(e) => setPremise(e.target.value)}
              placeholder="A second-chance summer romance set on Long Beach Island…" />
          </div>
          {analyzeError && <p className={styles.err}>Couldn't analyze — {analyzeError}</p>}
          <button className={styles.primary} onClick={analyze} disabled={analyzing || !premise.trim()}>
            {analyzing ? 'Analyzing…' : 'Analyze'}
          </button>
          {analyzing && (
            <div className={styles.progress}>
              <span className={styles.spinner} aria-hidden />
              <div className={styles.progText}>
                <div className={styles.progStage}>{ANALYZE_STAGES[stageForElapsed(elapsed)]}</div>
                <div className={styles.progMeta}>{elapsed}s elapsed · this usually takes 1–3 minutes</div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---- Review stage ----
  const field = (key: TextSeedField, label: string, rows: number, hint?: string) => (
    <div className={styles.idblock}>
      <div className={styles.fl}>{label}</div>
      {hint && <div className={styles.hint}>{hint}</div>}
      <textarea className={styles.area} rows={rows} value={seeds[key]}
        onChange={(e) => editSeed(key, e.target.value)} />
    </div>
  );

  return (
    <div className={styles.body}>
      <div className={styles.wrap}>
        <div className={styles.hero}>
          <h1>Review the <em>seeds</em></h1>
          <p>Everything below is editable. Resolve every gap and fact-check flag, then start the book.</p>
        </div>

        {result.groundingStatus === 'fallback-llm' && (
          <div className={styles.banner}>Geography grounded from model knowledge, not live web sources — double-check local specifics (street names, businesses) before publishing.</div>
        )}

        {/* Book identity */}
        <div className={styles.idblock}>
          <div className={styles.fl}>Title</div>
          <input className={styles.tin} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name your book" />
        </div>
        <div className={styles.row}>
          <div className={styles.idblock}>
            <div className={styles.fl}>Author</div>
            <select className={styles.tin} value={author} onChange={(e) => setAuthor(e.target.value)}>
              {authors.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
            </select>
          </div>
          <div className={styles.idblock}>
            <div className={styles.fl}>Voice</div>
            <select className={styles.tin} value={voice} onChange={(e) => setVoice(e.target.value)}>
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

        {/* Seeds */}
        {field('storyArc', 'Story arc', 5)}
        {field('characters', 'Characters', 6)}
        {field('setting', 'Grounded setting — verify against your local knowledge', 16)}
        {field('blueprint', 'Blueprint', 8)}

        <div className={styles.row}>
          <div className={styles.idblock}>
            <div className={styles.fl}>Chapters</div>
            <input className={styles.tin} type="number" min={1} value={seeds.chapterCount}
              onChange={(e) => editSeed('chapterCount', Number(e.target.value))} />
          </div>
          <div className={styles.idblock}>
            <div className={styles.fl}>Words per chapter</div>
            <input className={styles.tin} type="number" min={1} value={seeds.wordsPerChapter}
              onChange={(e) => editSeed('wordsPerChapter', Number(e.target.value))} />
          </div>
          <div className={styles.idblock}>
            <div className={styles.fl}>Heat</div>
            <div className={styles.toggle}>
              <button type="button" className={heatConfirmed && seeds.heat === 'sweet' ? styles.togSel : styles.togBtn}
                onClick={() => { editSeed('heat', 'sweet'); setHeatConfirmed(true); }}>Sweet</button>
              <button type="button" className={heatConfirmed && seeds.heat === 'spicy' ? styles.togSel : styles.togBtn}
                onClick={() => { editSeed('heat', 'spicy'); setHeatConfirmed(true); }}>Spicy</button>
            </div>
            {!heatConfirmed && (
              <div className={styles.progMeta}>
                Confirm the heat level — this picks the pipeline (Sweet = fade-to-black, Spicy = open-door).
                Suggested from your premise: <strong>{seeds.heat}</strong>.
              </div>
            )}
          </div>
        </div>

        {/* Fact-check discrepancies */}
        {result.discrepancies.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.h3}>Fact-check</h3>
            {failDiscs.map((d) => {
              const state = discResolution[d.id];
              return (
                <div key={d.id} className={styles.discCard}>
                  <div className={styles.discClaim}>{d.premiseClaim}</div>
                  <div className={styles.discFinding}>{d.finding}</div>
                  <div className={styles.discActions}>
                    {d.suggestion && (
                      <button type="button" className={state === 'applied' ? styles.chipSel : styles.chip}
                        onClick={() => applyDiscrepancy(d)}>Apply: {d.suggestion}</button>
                    )}
                    <button type="button" className={state === 'kept' ? styles.chipSel : styles.chip}
                      onClick={() => keepDiscrepancy(d)}>Keep intentional</button>
                  </div>
                </div>
              );
            })}
            {passDiscs.length > 0 && (
              <ul className={styles.verified}>
                {passDiscs.map((d) => <li key={d.id}>✓ {d.premiseClaim} — {d.finding}</li>)}
              </ul>
            )}
          </section>
        )}

        {/* Gaps */}
        {gaps.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.h3}>Open questions</h3>
            {gaps.map((g) => (
              <div key={g.id} className={styles.gapCard}>
                <div className={styles.fl}>{g.question}</div>
                <input className={styles.tin} value={gapAnswers[g.id] ?? ''}
                  onChange={(e) => setGapAnswers((m) => ({ ...m, [g.id]: e.target.value }))} />
                {g.alternatives && g.alternatives.length > 0 && (
                  <div className={styles.alts}>
                    {g.alternatives.map((alt) => (
                      <button key={alt} type="button" className={styles.chip}
                        onClick={() => setGapAnswers((m) => ({ ...m, [g.id]: alt }))}>{alt}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        {createError && <p className={styles.err}>Couldn't create — {createError}</p>}
        <button className={styles.primary} onClick={startBook} disabled={!canCreate}>
          {creating ? 'Starting…' : 'Start Book'}
        </button>
        {!canCreate && !creating && (
          <p className={styles.hint}>Resolve every open question and fact-check flag, and set a title, author, and voice, to start.</p>
        )}
      </div>
    </div>
  );
}
