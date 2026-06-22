import { useCallback, useEffect, useState } from 'react';
import { api, Button, useBooks, useStore } from '@bookclaw/shared';
import type { LibraryEntry, LibraryKind } from '@bookclaw/shared';
import { useDialog } from '../components/Dialog.js';
import { listWorlds } from '../lib/worldApi.js';
import type { WorldListRow } from '../lib/worldApi.js';
import styles from './Series.module.css';

interface SeriesRef { name: string; source: string }
interface Series {
  id: string;
  title: string;
  description: string;
  pulledFrom: { author?: SeriesRef; voice?: SeriesRef; genre?: SeriesRef | null; pipeline?: SeriesRef | null; world?: SeriesRef | null };
  bookSlugs: string[];
  readingOrder: string[];
}
interface Worldbuilding { characters: string; places: string; lore: string }
interface Report { stats: { totalBooks: number; totalWords: number; characterCount: number; locationCount: number }; contradictions: unknown[] }

type RefKind = 'author' | 'voice' | 'genre' | 'pipeline' | 'world';
const REF_KINDS: RefKind[] = ['author', 'voice', 'genre', 'pipeline'];
const OPTIONAL_REF = new Set<RefKind>(['genre', 'pipeline', 'world']);

export function Series() {
  const books = useBooks();
  const loadBooks = useStore((s) => s.loadBooks);
  const [series, setSeries] = useState<Series[]>([]);
  const [opts, setOpts] = useState<Partial<Record<LibraryKind, LibraryEntry[]>>>({});
  const [worlds, setWorlds] = useState<WorldListRow[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const { confirm } = useDialog();
  const [wb, setWb] = useState<Worldbuilding>({ characters: '', places: '', lore: '' });
  const [report, setReport] = useState<Report | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [pending, setPending] = useState<Record<string, string>>({}); // slug → confirmationId
  const [msg, setMsg] = useState<string | null>(null);

  const loadSeries = useCallback(
    () => api<{ series: Series[] }>('/api/series').then((r) => setSeries(r.series ?? [])).catch((e) => setMsg(String(e))),
    [],
  );

  useEffect(() => {
    loadSeries();
    loadBooks().catch(() => {});
    Promise.all(REF_KINDS.map((k) =>
      api<{ entries: LibraryEntry[] }>(`/api/library/${k}`).then((r) => [k, r.entries ?? []] as const).catch(() => [k, []] as const),
    )).then((pairs) => setOpts(Object.fromEntries(pairs) as Partial<Record<LibraryKind, LibraryEntry[]>>));
    listWorlds().then(setWorlds).catch(() => {});
  }, [loadSeries, loadBooks]);

  const sel = series.find((s) => s.id === selId) ?? null;

  useEffect(() => {
    setReport(null);
    if (!selId) { setWb({ characters: '', places: '', lore: '' }); return; }
    api<Worldbuilding>(`/api/series/${selId}/worldbuilding`).then(setWb).catch(() => setWb({ characters: '', places: '', lore: '' }));
  }, [selId]);

  const createSeries = async () => {
    const t = newTitle.trim();
    if (!t) return;
    try {
      const r = await api<{ series: Series }>('/api/series', { method: 'POST', body: JSON.stringify({ title: t }) });
      setNewTitle('');
      await loadSeries();
      setSelId(r.series.id);
    } catch (e) { setMsg(`Couldn't create — ${String(e)}`); }
  };
  const saveMeta = async (patch: { title?: string; description?: string }) => {
    if (!sel) return;
    await api(`/api/series/${sel.id}`, { method: 'PUT', body: JSON.stringify(patch) }).catch((e) => setMsg(String(e)));
    await loadSeries();
  };
  const setRef = async (kind: RefKind, name: string) => {
    if (!sel) return;
    await api(`/api/series/${sel.id}/refs`, { method: 'PUT', body: JSON.stringify({ [kind]: name || null }) }).catch((e) => setMsg(String(e)));
    await loadSeries();
  };
  const saveWb = async () => {
    if (!sel) return;
    try { await api(`/api/series/${sel.id}/worldbuilding`, { method: 'PUT', body: JSON.stringify(wb) }); setMsg('World-building saved.'); }
    catch (e) { setMsg(`Save failed — ${String(e)}`); }
  };
  const addBook = async (slug: string) => {
    if (!sel || !slug) return;
    await api(`/api/series/${sel.id}/add-book`, { method: 'POST', body: JSON.stringify({ slug }) }).catch((e) => setMsg(String(e)));
    await loadSeries();
  };
  const removeBook = async (slug: string) => {
    if (!sel) return;
    await api(`/api/series/${sel.id}/remove-book`, { method: 'POST', body: JSON.stringify({ slug }) }).catch((e) => setMsg(String(e)));
    setPending((p) => { if (!(slug in p)) return p; const n = { ...p }; delete n[slug]; return n; });
    await loadSeries();
  };
  const reorder = async (slug: string, dir: -1 | 1) => {
    if (!sel) return;
    const order = [...(sel.readingOrder.length ? sel.readingOrder : sel.bookSlugs)];
    const i = order.indexOf(slug);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    await api(`/api/series/${sel.id}/reading-order`, { method: 'POST', body: JSON.stringify({ order }) }).catch((e) => setMsg(String(e)));
    await loadSeries();
  };
  const viewReport = async () => {
    if (!sel) return;
    try { setReport(await api<Report>(`/api/series/${sel.id}/report`)); }
    catch (e) { setMsg(`Report failed — ${String(e)}`); }
  };
  const pull = async (slug: string) => {
    if (!sel) return;
    try {
      const r = await api<{ confirmationId?: string; pulled?: string }>(`/api/series/${sel.id}/pull/${encodeURIComponent(slug)}`, { method: 'POST', body: JSON.stringify({}) });
      if (r.confirmationId) { setPending((p) => ({ ...p, [slug]: r.confirmationId! })); setMsg('Approve the pull in Confirmations, then Finalize.'); }
      else { setMsg(`Pulled series assets into ${slug}.`); }
    } catch (e) { setMsg(`Pull failed — ${String(e)}`); }
  };
  const finalizePull = async (slug: string) => {
    if (!sel) return;
    const confirmationId = pending[slug];
    if (!confirmationId) return;
    try {
      await api(`/api/series/${sel.id}/pull/${encodeURIComponent(slug)}`, { method: 'POST', body: JSON.stringify({ confirmationId }) });
      setPending((p) => { const n = { ...p }; delete n[slug]; return n; });
      setMsg(`Pulled series assets into ${slug}.`);
    } catch (e) {
      setMsg((e as { status?: number }).status === 409 ? 'Not approved yet — approve it in Confirmations first.' : `Finalize failed — ${String(e)}`);
    }
  };
  const del = async () => {
    if (!sel) return;
    if (!(await confirm(`Delete series "${sel.title}"? Member books are NOT deleted.`))) return;
    await api(`/api/series/${sel.id}`, { method: 'DELETE' }).catch((e) => setMsg(String(e)));
    setSelId(null);
    await loadSeries();
  };

  const titleOf = (slug: string) => books.find((b) => b.slug === slug)?.title ?? slug;
  const order = sel ? (sel.readingOrder.length ? sel.readingOrder : sel.bookSlugs) : [];
  const nonMembers = books.filter((b) => !sel?.bookSlugs.includes(b.slug));

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Series</h1>
      {msg && <p className={styles.msg} onClick={() => setMsg(null)}>{msg}</p>}

      <div className={styles.cols}>
        {/* List */}
        <div className={styles.list}>
          {series.length === 0 && <p className={styles.dim}>No series yet.</p>}
          {series.map((s) => (
            <button key={s.id} className={s.id === selId ? `${styles.row} ${styles.on}` : styles.row} onClick={() => setSelId(s.id)}>
              <span className={styles.sname}>{s.title}</span>
              <span className={styles.scount}>{s.bookSlugs.length} book{s.bookSlugs.length === 1 ? '' : 's'}</span>
            </button>
          ))}
          <div className={styles.newRow}>
            <input value={newTitle} placeholder="New series title…" onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') createSeries(); }} />
            <Button variant="secondary" onClick={createSeries} disabled={!newTitle.trim()}>Add</Button>
          </div>
        </div>

        {/* Detail */}
        <div className={styles.detail}>
          {!sel ? (
            <p className={styles.dim}>Select a series, or create one.</p>
          ) : (
            <>
              <div className={styles.sec}>Series</div>
              <input className={styles.titleInput} defaultValue={sel.title} key={`t-${sel.id}`} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== sel.title) saveMeta({ title: v }); }} />
              <textarea className={styles.descInput} defaultValue={sel.description} key={`d-${sel.id}`} placeholder="Description…" onBlur={(e) => { if (e.target.value !== sel.description) saveMeta({ description: e.target.value }); }} />

              <div className={styles.sec}>Shared assets <small>· inherited by books created in this series</small></div>
              <div className={styles.refs}>
                {REF_KINDS.map((kind) => (
                  <label key={kind} className={styles.ref}>
                    <span>{kind}</span>
                    <select value={sel.pulledFrom[kind]?.name ?? ''} onChange={(e) => setRef(kind, e.target.value)}>
                      {OPTIONAL_REF.has(kind) && <option value="">— none —</option>}
                      {!OPTIONAL_REF.has(kind) && <option value="">— select —</option>}
                      {(opts[kind] ?? []).map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
                    </select>
                  </label>
                ))}
                <label className={styles.ref}>
                  <span>world</span>
                  <select value={sel.pulledFrom.world?.name ?? ''} onChange={(e) => setRef('world', e.target.value)}>
                    <option value="">— none —</option>
                    {worlds.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
                  </select>
                </label>
              </div>

              <div className={styles.sec}>World-building <small>· canon snapshotted into each book + injected into prompts</small></div>
              {(['characters', 'places', 'lore'] as const).map((k) => (
                <label key={k} className={styles.wb}>
                  <span>{k}</span>
                  <textarea value={wb[k]} onChange={(e) => setWb((p) => ({ ...p, [k]: e.target.value }))} placeholder={`${k}…`} />
                </label>
              ))}
              <Button variant="primary" onClick={saveWb}>Save world-building</Button>

              <div className={styles.sec}>Books</div>
              {order.length === 0 && <p className={styles.dim}>No member books yet.</p>}
              {order.map((slug, i) => (
                <div key={slug} className={styles.member}>
                  <span className={styles.mtitle}>{titleOf(slug)}</span>
                  <button className={styles.icon} disabled={i === 0} onClick={() => reorder(slug, -1)} aria-label="Move up">▲</button>
                  <button className={styles.icon} disabled={i === order.length - 1} onClick={() => reorder(slug, 1)} aria-label="Move down">▼</button>
                  {pending[slug]
                    ? <button className={styles.linkbtn} onClick={() => finalizePull(slug)}>Finalize</button>
                    : <button className={styles.linkbtn} onClick={() => pull(slug)}>Pull assets</button>}
                  <button className={styles.del} onClick={() => removeBook(slug)}>Remove</button>
                </div>
              ))}
              <div className={styles.addRow}>
                <select defaultValue="" key={`add-${sel.id}-${sel.bookSlugs.length}`} onChange={(e) => { if (e.target.value) addBook(e.target.value); }}>
                  <option value="">Add a book…</option>
                  {nonMembers.map((b) => <option key={b.slug} value={b.slug}>{b.title}</option>)}
                </select>
              </div>

              <div className={styles.sec}>Continuity report</div>
              <Button variant="secondary" onClick={viewReport}>View report</Button>
              {report && (
                <p className={styles.report}>
                  {report.stats.totalBooks} book(s) · {report.stats.totalWords.toLocaleString()} words · {report.stats.characterCount} characters · {report.stats.locationCount} locations · {report.contradictions.length} contradiction(s)
                </p>
              )}

              <div className={styles.danger}>
                <Button variant="secondary" onClick={del}>Delete series</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
