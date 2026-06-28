import { useEffect, useRef, useState } from 'react';
import { useBooks, useStore, useActiveBook } from '@bookclaw/shared';
import { FileTree } from '../components/files/FileTree.js';
import { FileViewer } from '../components/files/FileViewer.js';
import {
  buildTree, listBookFiles, listDocuments, uploadToBookDir, uploadDocument, type TreeNode,
} from '../lib/filesExplorerApi.js';
import styles from './Files.module.css';

export function Files() {
  const books = useBooks();
  const activeBook = useActiveBook();
  const loadBooks = useStore((s) => s.loadBooks);
  // Defaults to the active book; the selector can switch to any other book.
  const [slug, setSlug] = useState('');
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [currentDir, setCurrentDir] = useState('data'); // upload target (book-root dir, or "Documents")
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => { loadBooks().catch(() => {}); }, [loadBooks]);
  useEffect(() => {
    if (!slug && books.length) setSlug(activeBook?.slug ?? books[0].slug);
  }, [books, activeBook, slug]);

  const refresh = () => {
    setErr(null);
    // Documents (workspace) load regardless of the selected book so they stay
    // reachable even with zero books; book files load only when a book is selected.
    const bf = slug ? listBookFiles(slug).catch(() => ({ files: [] })) : Promise.resolve({ files: [] as { path: string; bytes?: number }[] });
    Promise.all([bf, listDocuments().catch(() => ({ documents: [] }))])
      .then(([b, d]) => setTree(buildTree(b.files ?? [], d.documents ?? [])))
      .catch((e) => setErr(String(e)));
  };
  useEffect(() => { setSelected(null); setCurrentDir(slug ? 'data' : 'Documents'); refresh(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPick = (file: File | undefined) => {
    if (!file || !slug) return;
    setUploading(true); setErr(null);
    const job = currentDir === 'Documents' ? uploadDocument(file) : uploadToBookDir(slug, currentDir, file);
    job.then(() => refresh())
      .catch((e) => setErr(`Upload failed — ${String(e)}`))
      .finally(() => setUploading(false));
  };

  return (
    <div className={styles.scroll}>
      <div className={styles.bar}>
        <label className={styles.bookSel}>
          Book
          <select value={slug} onChange={(e) => setSlug(e.target.value)}>
            {!slug && <option value="">Select a book…</option>}
            {books.map((b) => <option key={b.slug} value={b.slug}>{b.title}</option>)}
          </select>
        </label>
        <span className={styles.target}>Upload to <code>{currentDir}/</code></span>
        <span style={{ flex: 1 }} />
        <button
          className={styles.upload}
          disabled={uploading || (currentDir !== 'Documents' && !slug)}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? 'Uploading…' : '⬆ Upload'}
        </button>
        <input
          ref={fileInput} type="file" hidden
          accept={currentDir === 'Documents' ? '.txt,.md,.docx' : '.md,.txt,.json,.csv'}
          onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ''; }}
        />
      </div>

      {err && <p className={styles.err}>{err}</p>}

      <div className={styles.body}>
        <div className={styles.tree}>
          <FileTree nodes={tree} selectedPath={selected?.path} currentDir={currentDir} onSelectFile={setSelected} onSelectDir={(n) => setCurrentDir(n.path)} />
        </div>
        <div className={styles.viewer}>
          <FileViewer slug={slug} node={selected} onChanged={refresh} onClose={() => setSelected(null)} />
        </div>
      </div>
    </div>
  );
}
