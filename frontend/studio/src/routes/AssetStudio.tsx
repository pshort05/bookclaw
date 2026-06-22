import { useState, useEffect } from 'react';
import { api, useStore, useActiveBook, useBooks } from '@bookclaw/shared';
import type { LibraryKind } from '@bookclaw/shared';
import type { Scope } from '../lib/assetApi.js';
import { KindRail } from '../components/asset/KindRail.js';
import { EntryList } from '../components/asset/EntryList.js';
import { ProseEditor } from '../components/asset/ProseEditor.js';
import { PipelineEditor } from '../components/asset/PipelineEditor.js';
import { SequenceEditor } from '../components/asset/SequenceEditor.js';
import { SkillEditor } from '../components/asset/SkillEditor.js';
import { EditorEditor } from '../components/asset/EditorEditor.js';
import { PromptEditor } from '../components/asset/PromptEditor.js';
import { WorldEditor } from '../components/asset/WorldEditor.js';
import { RepullPanel } from '../components/asset/RepullPanel.js';
import styles from './AssetStudio.module.css';

export function AssetStudio() {
  const loadBooks = useStore((s) => s.loadBooks);
  const activeBook = useActiveBook();
  const books = useBooks();
  const activeSlug = activeBook?.slug;

  const [scope, setScope] = useState<Scope>('library');
  const [kind, setKind] = useState<LibraryKind>('author');
  const [selectedName, setSelectedName] = useState<string | null>(null);
  // Key to force editor remount on scope/kind/name change (clears dirty state).
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => { loadBooks().catch(() => {}); }, [loadBooks]);

  function handleScope(s: Scope) {
    if (s === scope) return;
    setScope(s);
    setSelectedName(null);
  }

  function handleKind(k: LibraryKind) {
    if (k === kind) return;
    setKind(k);
    setSelectedName(null);
  }

  function handleSelect(name: string | null) {
    setSelectedName(name);
    setEditorKey((n) => n + 1);
  }

  // Pick which book to view: set it active (the book-scope endpoints read the
  // active-book pointer), then switch to book scope to show its files.
  async function pickBook(slug: string) {
    if (!slug) return;
    if (slug !== activeSlug) {
      try {
        await api('/api/books/active', { method: 'POST', body: JSON.stringify({ slug }) });
        await loadBooks();
      } catch { return; } // non-fatal: selection just won't switch
    }
    setScope('book');
    setSelectedName(null);
    setEditorKey((n) => n + 1);
  }

  const bookTitle = activeBook?.title ?? 'Active book';
  const noBook = !activeBook;

  // In book scope, single-snapshot kinds carry their snapshotted asset name on the
  // active book's flat fields (author/voice/genre/pipeline, from GET /api/books). Show
  // that real name in the editor header instead of the bare kind string.
  const snapshotNames: Record<string, string | null | undefined> = activeBook
    ? { author: activeBook.author, voice: activeBook.voice, genre: activeBook.genre, pipeline: activeBook.pipeline }
    : {};
  const bookDisplayName = scope === 'book' ? (snapshotNames[kind] ?? undefined) : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Topbar */}
      <header className={styles.topbar}>
        <div className={styles.crumb}>
          <b>Make</b><span className={styles.sep}>/</span>Library &amp; Assets
        </div>
        <div className={styles.scope}>
          <span className={styles.lab}>Editing</span>
          <div className={styles.seg}>
            <button
              className={scope === 'library' ? styles.on : undefined}
              onClick={() => handleScope('library')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v6l9 4 9-4V7"/>
              </svg>
              Library
            </button>
            <button
              className={`${scope === 'book' ? styles.on + ' ' + styles.book : styles.book}`}
              onClick={() => { if (!noBook) handleScope('book'); }}
              disabled={noBook}
              title={noBook ? 'No active book — set one on the Book Board first' : bookTitle}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/>
              </svg>
              {bookTitle}
            </button>
          </div>
          <select
            className={styles.bookpick}
            value={scope === 'book' ? (activeSlug ?? '') : ''}
            onChange={(e) => pickBook(e.target.value)}
            title="Choose which book's files to view"
          >
            <option value="">{books.length ? '— choose a book —' : 'No books yet'}</option>
            {books.map((b) => <option key={b.slug} value={b.slug}>{b.title}</option>)}
          </select>
        </div>
      </header>

      {/* Scope banners */}
      {scope === 'library' && (
        <div className={`${styles.banner} ${styles.lib}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>
          </svg>
          <span>Editing the <b>shared library</b>. Changes apply to <b>new books</b> you create from now on — existing books keep their own frozen copy until you re-pull.</span>
        </div>
      )}
      {scope === 'book' && (
        <div className={`${styles.banner} ${styles.book}`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/>
          </svg>
          <span>Editing this book's <b>private snapshot</b>. Changes stay inside <b>{bookTitle}</b> and never touch the shared library or any other book.</span>
        </div>
      )}

      {/* Re-pull panel (book scope only) */}
      {scope === 'book' && activeBook && (
        <RepullPanel onRefreshEditor={() => setEditorKey((n) => n + 1)} />
      )}

      {/* Three-pane work area */}
      <div className={styles.work}>
        <KindRail kind={kind} onKind={handleKind} />

        <EntryList
          key={scope === 'book' ? `book:${activeSlug ?? ''}` : 'library'}
          scope={scope}
          kind={kind}
          selectedName={selectedName}
          onSelect={handleSelect}
        />

        <div className={styles.editor}>
          {selectedName ? (
            kind === 'pipeline' ? (
              <PipelineEditor key={editorKey} scope={scope} kind={kind} name={selectedName} displayName={bookDisplayName} />
            ) : kind === 'sequence' ? (
              <SequenceEditor key={editorKey} scope={scope} kind={kind} name={selectedName} displayName={bookDisplayName} />
            ) : kind === 'skill' ? (
              <SkillEditor key={editorKey} scope={scope} kind={kind} name={selectedName} displayName={bookDisplayName} />
            ) : kind === 'editor' ? (
              <EditorEditor key={editorKey} scope={scope} kind={kind} name={selectedName} displayName={bookDisplayName} />
            ) : kind === 'prompt' ? (
              <PromptEditor key={editorKey} scope={scope} kind={kind} name={selectedName} displayName={bookDisplayName} />
            ) : kind === 'world' ? (
              <WorldEditor key={editorKey} scope={scope} name={selectedName} />
            ) : (
              <ProseEditor key={editorKey} scope={scope} kind={kind} name={selectedName} displayName={bookDisplayName} />
            )
          ) : (
            <div style={{ color: 'var(--faint)', fontSize: 13, paddingTop: 40 }}>
              Select an asset from the list to edit it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
