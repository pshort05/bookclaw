import { useState, useEffect } from 'react';
import { useStore, useActiveBook } from '@bookclaw/shared';
import type { LibraryKind } from '@bookclaw/shared';
import type { Scope } from '../lib/assetApi.js';
import { KindRail } from '../components/asset/KindRail.js';
import { EntryList } from '../components/asset/EntryList.js';
import { ProseEditor } from '../components/asset/ProseEditor.js';
import { PipelineEditor } from '../components/asset/PipelineEditor.js';
import { RepullPanel } from '../components/asset/RepullPanel.js';
import styles from './AssetStudio.module.css';

export function AssetStudio() {
  const loadBooks = useStore((s) => s.loadBooks);
  const activeBook = useActiveBook();

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

  const bookTitle = activeBook?.title ?? 'Active book';
  const noBook = !activeBook;

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
          scope={scope}
          kind={kind}
          selectedName={selectedName}
          onSelect={handleSelect}
        />

        <div className={styles.editor}>
          {selectedName ? (
            kind === 'pipeline' ? (
              <PipelineEditor key={editorKey} scope={scope} kind={kind} name={selectedName} />
            ) : (
              <ProseEditor key={editorKey} scope={scope} kind={kind} name={selectedName} />
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
