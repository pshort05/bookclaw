import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type BookManifest } from '@bookclaw/shared';
import { BookContents } from './BookContents.js';
import { ReadingPane } from './ReadingPane.js';
import { RawPane } from './RawPane.js';
import { useBookViewShortcut } from './useBookViewShortcut.js';
import type { BookItem, CompileResponse, ContentsResponse, ItemResponse, RunState } from './types.js';
import styles from './BookView.module.css';

/** Below this much CONTAINER width the three panes stop fitting (design §8). */
const MIN_WIDTH = 1200;

/** Pane widths: defaults, the range a drag may set, and where they are remembered. */
const PANE = {
  toc: { def: 282, min: 190, max: 560, key: 'bookview.tocW' },
  raw: { def: 440, min: 280, max: 860, key: 'bookview.rawW' },
} as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Remembered per reader, per browser. Storage can throw (private windows,
 *  blocked site data), so every read and write is guarded and falls back to
 *  the default width. */
function storedWidth(pane: keyof typeof PANE): number {
  const { def, min, max, key } = PANE[pane];
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? clamp(n, min, max) : def;
  } catch { return def; }
}

function rememberWidth(pane: keyof typeof PANE, px: number): void {
  try { window.localStorage.setItem(PANE[pane].key, String(Math.round(px))); } catch { /* not fatal */ }
}

export interface BookViewProps {
  slug: string;
  initialItem?: string;
  panes?: { contents?: boolean; raw?: boolean };
  onClose?: () => void;
}

/** `Paused · gate at chapter 19` / `Writing chapter 12 of 24` / `Complete · 24 of 24`. */
function runChip(run: RunState): { cls: string; label: string } | null {
  const { status, frontier, total } = run;
  if (status === 'none') return null;
  if (status === 'gated') return { cls: styles.gate, label: `Paused · gate at chapter ${frontier}` };
  if (status === 'writing') return { cls: styles.generating, label: `Writing chapter ${frontier} of ${total}` };
  if (status === 'paused') return { cls: styles.idle, label: `Paused · ${frontier} of ${total} written` };
  return { cls: styles.complete, label: `Complete · ${frontier} of ${total}` };
}

/**
 * View Book — one surface where a book is read in order, its latest text is
 * edited in place, and a paused run's gate is decided next to the prose it
 * gated (design §1).
 *
 * Mountable by contract: it reads NOTHING from the URL and NOTHING from global
 * state, so the same component serves the route, an overlay and a gate mount.
 * Everything it needs arrives as props; everything it owns — selection,
 * version choice, pane visibility, dirty state — stays here.
 */
export function BookView({ slug, initialItem, panes, onClose }: BookViewProps) {
  const [book, setBook] = useState<BookManifest | null>(null);
  const [contents, setContents] = useState<ContentsResponse | null>(null);
  const [contentsErr, setContentsErr] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(initialItem ?? null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [showContents, setShowContents] = useState(panes?.contents !== false);
  const [showRaw, setShowRaw] = useState(panes?.raw !== false);

  const [loaded, setLoaded] = useState<ItemResponse | null>(null);
  const [itemLoading, setItemLoading] = useState(false);
  const [itemErr, setItemErr] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const [compiled, setCompiled] = useState<CompileResponse | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileErr, setCompileErr] = useState<string | null>(null);

  const [narrow, setNarrow] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Resizable panes. Widths live in state (so a drag re-renders) and are
  // mirrored to localStorage on release.
  const [tocW, setTocW] = useState(() => storedWidth('toc'));
  const [rawW, setRawW] = useState(() => storedWidth('raw'));
  const [dragging, setDragging] = useState<null | 'toc' | 'raw'>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  /** Drag a splitter: the left one sets the contents width from the pointer's
   *  distance to the frame's left edge, the right one from its distance to the
   *  right edge. Pointer capture keeps the drag alive over the other panes. */
  const startDrag = useCallback((pane: 'toc' | 'raw') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(pane);

    const move = (ev: PointerEvent) => {
      const box = frameRef.current?.getBoundingClientRect();
      if (!box) return;
      if (pane === 'toc') setTocW(clamp(ev.clientX - box.left, PANE.toc.min, PANE.toc.max));
      else setRawW(clamp(box.right - ev.clientX, PANE.raw.min, PANE.raw.max));
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setDragging(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }, []);

  // Persist once the drag settles rather than on every pointermove.
  useEffect(() => { if (!dragging) rememberWidth('toc', tocW); }, [tocW, dragging]);
  useEffect(() => { if (!dragging) rememberWidth('raw', rawW); }, [rawW, dragging]);

  /** Arrow keys nudge a focused splitter, so the panes are resizable without a mouse. */
  const nudge = useCallback((pane: 'toc' | 'raw') => (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 12;
    let delta = 0;
    if (e.key === 'ArrowLeft') delta = -step;
    else if (e.key === 'ArrowRight') delta = step;
    else if (e.key === 'Home') delta = NaN;         // reset
    else return;
    e.preventDefault();
    const set = pane === 'toc' ? setTocW : setRawW;
    const { min, max, def } = PANE[pane];
    if (Number.isNaN(delta)) { set(def); return; }
    // the right-hand pane grows when its splitter moves LEFT
    const signed = pane === 'raw' ? -delta : delta;
    set((w) => clamp(w + signed, min, max));
  }, []);

  // Escape closes, matching the shell's convention. The `b`-to-open half of the
  // accelerator belongs to whatever mounts this view, not to the view itself.
  useBookViewShortcut({ onClose });

  // Size to the CONTAINER, never the viewport — an overlay at 1,400px has to
  // behave like a page at 1,400px.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < MIN_WIDTH));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // `isCancelled` lets a caller that can be superseded (the per-slug effect)
  // drop a slow response instead of writing another book's tree into state.
  const loadContents = useCallback(async (isCancelled?: () => boolean) => {
    const r = await api<ContentsResponse>(`/api/books/${encodeURIComponent(slug)}/contents`);
    if (isCancelled?.()) return;
    setContents(r);
    setContentsErr(null);
  }, [slug]);

  // Book identity for the header — the manifest, not the contents tree.
  useEffect(() => {
    let cancelled = false;
    setBook(null);
    api<{ book: BookManifest }>(`/api/books/${encodeURIComponent(slug)}`)
      .then((d) => { if (!cancelled) setBook(d.book); })
      .catch(() => { /* header falls back to the slug */ });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => {
    let cancelled = false;
    setContents(null);
    setContentsErr(null);
    setCompiled(null);
    loadContents(() => cancelled).catch((e) => { if (!cancelled) setContentsErr(String(e)); });
    return () => { cancelled = true; };
  }, [loadContents]);

  const allItems: BookItem[] = useMemo(
    () => (contents?.groups ?? []).flatMap((g) => g.items),
    [contents],
  );

  // Open on `initialItem`, else the first ready item, else the first item at all.
  useEffect(() => {
    if (allItems.length === 0) return;
    if (selectedId && allItems.some((i) => i.id === selectedId)) return;
    const wanted = initialItem ? allItems.find((i) => i.id === initialItem) : undefined;
    const first = wanted ?? allItems.find((i) => i.ready) ?? allItems[0];
    setSelectedId(first.id);
    setVersionId(null);
  }, [allItems, initialItem, selectedId]);

  // The open item's body — the only thing fetched per selection.
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    // Clear first: a stale body under a new title would read as this item's text.
    setLoaded(null);
    setDraft('');
    setItemLoading(true);
    setItemErr(null);
    setSaveErr(null);
    const q = versionId ? `?version=${encodeURIComponent(versionId)}` : '';
    api<ItemResponse>(`/api/books/${encodeURIComponent(slug)}/items/${encodeURIComponent(selectedId)}${q}`)
      .then((r) => {
        if (cancelled) return;
        setLoaded(r);
        setDraft(r.body);
      })
      .catch((e) => { if (!cancelled) { setLoaded(null); setItemErr(String(e)); } })
      .finally(() => { if (!cancelled) setItemLoading(false); });
    return () => { cancelled = true; };
  }, [slug, selectedId, versionId, reloadKey]);

  const selectItem = (id: string) => {
    setSelectedId(id);
    setVersionId(null);   // always land on the latest version
  };

  const run: RunState = contents?.run ?? { status: 'none', frontier: 0, total: 0 };
  const item = useMemo(
    () => allItems.find((i) => i.id === selectedId) ?? loaded?.item ?? null,
    [allItems, selectedId, loaded],
  );
  const group = contents?.groups.find((g) => g.id === item?.group);
  const dirty = loaded != null && draft !== loaded.body;
  const editable = loaded?.editable === true;
  const gatedHere = run.status === 'gated' && run.gate?.itemId === item?.id;

  const save = async () => {
    if (!loaded || !selectedId) return;
    setSaving(true);
    setSaveErr(null);
    try {
      await api(`/api/books/${encodeURIComponent(slug)}/items/${encodeURIComponent(selectedId)}`, {
        method: 'PUT',
        body: JSON.stringify({ body: draft, versionId: loaded.version?.id ?? '' }),
      });
      // A gate-edit save resolves the gate and resumes the run, so the tree has
      // to come back too — not just the body.
      await loadContents().catch(() => {});
      setReloadKey((n) => n + 1);
    } catch (e) {
      setSaveErr(`Couldn't save — ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const gateResolved = async () => {
    await loadContents().catch(() => {});
    setReloadKey((n) => n + 1);
  };

  const compile = async () => {
    if (compiling) return;
    setCompiling(true);
    setCompileErr(null);
    try {
      const r = await api<CompileResponse>(`/api/books/${encodeURIComponent(slug)}/compile`, { method: 'POST' });
      setCompiled(r);
      await loadContents().catch(() => {});
    } catch (e) {
      setCompileErr(String(e));
    } finally {
      setCompiling(false);
    }
  };

  // ── header copy ────────────────────────────────────────────────────────
  const title = book?.title ?? slug;
  const author = book?.pulledFrom?.author?.name;
  const genre = book?.pulledFrom?.genre?.name;
  const manuscript = contents?.groups.find((g) => g.id === 'manuscript');
  const words = (manuscript?.items ?? allItems).reduce((n, i) => n + (i.words ?? 0), 0);
  const chip = runChip(run);
  const partial = run.total > 0 && run.frontier < run.total;

  // The server says WHY it refused; fall back to the local wording when it
  // didn't (an older gateway, or a state the client reached first).
  const lockReason = loaded?.lockReason ?? (!item
    ? 'nothing open'
    : !item.ready
    ? `nothing to edit — run ${item.producedBy?.skill ?? 'the step that writes it'} first`
    : item.derived
      ? 'compiled output — edit a chapter and compile again'
      : loaded?.version && !loaded.version.latest
        ? `${loaded.version.label} — earlier version, editing disabled`
        : 'read-only');

  const saveLabel = gatedHere && loaded?.version?.latest
    ? 'Approve with my edits'
    : item?.kind === 'prose' ? 'Save chapter' : 'Save document';

  const delta = item?.words != null
    ? `${item.words.toLocaleString()} words`
    : item?.kind === 'document' ? 'document' : '';

  return (
    <div className={styles.root} ref={rootRef}>
      <header className={styles.head}>
        {onClose && (
          <button className={styles.back} onClick={onClose} aria-label="Close View Book">← Back</button>
        )}
        <div className={styles.id}>
          <div className={styles.bk}>{title}</div>
          <div className={styles.by}>{[author, genre].filter(Boolean).join(' · ')}</div>
        </div>

        <div className={styles.stats}>
          {run.total > 0 && <span>{run.total}&nbsp;<b>chapters</b></span>}
          {words > 0 && <span><b>{words.toLocaleString()}</b>&nbsp;words</span>}
        </div>

        <div className={styles.genwrap}>
          {chip && (
            <div className={`${styles.runchip} ${chip.cls}`}>
              <span className={styles.pulse} />
              {chip.label}
              {run.status !== 'complete' && run.frontier > 0 && (
                <>
                  {' · '}
                  <button onClick={() => selectItem(`chapter:${run.frontier}`)}>
                    go to chapter {run.frontier}
                  </button>
                </>
              )}
            </div>
          )}
          <button
            className={styles.gen}
            data-busy={compiling ? '1' : undefined}
            onClick={compile}
            disabled={compiling}
          >
            {compiling ? 'Compiling…' : compiled ? 'Compile again' : partial ? 'Compile anyway' : 'Compile'}
          </button>
          <div className={styles.genstate}>
            {compileErr ? (
              <span className={styles.bad}>compile failed — {compileErr}</span>
            ) : compiled ? (
              <><b>{compiled.file.split('/').pop()}</b><br />{compiled.words.toLocaleString()} words · {compiled.chapters} chapters</>
            ) : partial ? (
              <>partial book<br />{run.frontier} of {run.total} chapters</>
            ) : (
              'never compiled'
            )}
          </div>
        </div>

        <div className={styles.panes}>
          <button aria-pressed={showContents} onClick={() => setShowContents((v) => !v)}>Contents</button>
          <button aria-pressed={showRaw} onClick={() => setShowRaw((v) => !v)}>Raw</button>
        </div>
      </header>

      {narrow ? (
        <div className={styles.toonarrow}>
          <div className={styles.ic}>Wider window needed</div>
          <h2>View Book reads three panes at once</h2>
          <p>
            Contents, the typeset chapter, and its raw markdown need about 1,200px of width.
            Widen the window, or open the chapter in Write.
          </p>
        </div>
      ) : contentsErr ? (
        <div className={styles.shellnote}>
          <span><b className={styles.bad}>Couldn't read this book</b> — {contentsErr}</span>
        </div>
      ) : !contents ? (
        <div className={styles.shellnote}>Loading the book…</div>
      ) : (
        <div
          ref={frameRef}
          className={`${styles.frame} ${showContents ? '' : styles.noToc} ${showRaw ? '' : styles.noRaw} ${dragging ? styles.resizing : ''}`}
          style={{ '--tocW': `${tocW}px`, '--rawW': `${rawW}px` } as React.CSSProperties}
        >
          <nav className={`${styles.col} ${styles.rail}`} aria-label="Contents">
            <BookContents
              groups={contents.groups}
              run={run}
              selectedId={selectedId}
              onSelect={selectItem}
            />
          </nav>

          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the contents pane"
            aria-valuenow={Math.round(tocW)}
            aria-valuemin={PANE.toc.min}
            aria-valuemax={PANE.toc.max}
            tabIndex={0}
            className={`${styles.splitter} ${styles.splitLeft} ${dragging === 'toc' ? styles.dragging : ''}`}
            onPointerDown={startDrag('toc')}
            onKeyDown={nudge('toc')}
            onDoubleClick={() => setTocW(PANE.toc.def)}
          />

          <main className={styles.col}>
            <ReadingPane
              item={item}
              version={loaded?.version ?? null}
              body={loaded?.body ?? ''}
              run={run}
              groupLabel={group?.label ?? ''}
              bookTitle={title}
              authorName={author}
              loading={itemLoading}
              error={itemErr}
              onSelectItem={selectItem}
              onSelectVersion={setVersionId}
              onGateResolved={gateResolved}
            />
          </main>

          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the raw markdown pane"
            aria-valuenow={Math.round(rawW)}
            aria-valuemin={PANE.raw.min}
            aria-valuemax={PANE.raw.max}
            tabIndex={0}
            className={`${styles.splitter} ${styles.splitRight} ${dragging === 'raw' ? styles.dragging : ''}`}
            onPointerDown={startDrag('raw')}
            onKeyDown={nudge('raw')}
            onDoubleClick={() => setRawW(PANE.raw.def)}
          />

          <aside className={styles.rawcol}>
            <RawPane
              file={loaded?.file ?? null}
              value={draft}
              dirty={dirty}
              editable={editable}
              lockReason={lockReason}
              saveLabel={saveLabel}
              delta={delta}
              saving={saving}
              error={saveErr}
              onChange={setDraft}
              onSave={save}
              onRevert={() => setDraft(loaded?.body ?? '')}
            />
          </aside>
        </div>
      )}
    </div>
  );
}
