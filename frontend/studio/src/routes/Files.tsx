import { useEffect, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { api, apiBase, authToken, Button, useBooks, useStore } from '@bookclaw/shared';
import styles from './Files.module.css';

type Tab = 'documents' | 'books';

interface FileRow {
  name: string;   // filename used in the content/download URL
  size: number;
  meta?: string;  // small right-aligned label (words / modified)
}

const TEXT_RE = /\.(md|markdown|txt|text|log|csv|json)$/i;
const MD_RE = /\.(md|markdown)$/i;
const isText = (name: string) => TEXT_RE.test(name);

function fmtSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

// Previews need the raw file body; api() parses JSON, so fetch text directly
// (with the bearer header).
async function fetchText(path: string): Promise<string> {
  const t = authToken();
  const res = await fetch(apiBase() + path, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}


export function Files() {
  const books = useBooks();
  const loadBooks = useStore((s) => s.loadBooks);
  const [tab, setTab] = useState<Tab>('documents');

  const [docs, setDocs] = useState<FileRow[]>([]);
  const [bookSlug, setBookSlug] = useState('');
  const [bookFiles, setBookFiles] = useState<FileRow[]>([]);

  // The selected file's content URL (sans ?download), display name, and previewability.
  const [sel, setSel] = useState<{ path: string; name: string; canDelete: boolean } | null>(null);
  const [preview, setPreview] = useState<string | null>(null); // rendered/plain text, or null for binary
  const [previewMd, setPreviewMd] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const loadDocs = () =>
    api<{ documents: Array<{ filename: string; size: number; wordCount?: number }> }>('/api/documents')
      .then((r) => setDocs((r.documents ?? []).map((d) => ({
        name: d.filename, size: d.size, meta: d.wordCount ? `${d.wordCount.toLocaleString()} words` : undefined,
      }))))
      .catch((e) => setErr(String(e)));

  const loadBookFiles = (slug: string) => {
    if (!slug) { setBookFiles([]); return; }
    api<{ files: Array<{ name: string; bytes: number; modified: string }> }>(`/api/books/${encodeURIComponent(slug)}/files`)
      .then((r) => setBookFiles((r.files ?? []).map((f) => ({
        name: f.name, size: f.bytes, meta: f.modified ? new Date(f.modified).toLocaleString() : undefined,
      }))))
      .catch((e) => setErr(String(e)));
  };

  useEffect(() => { loadDocs(); loadBooks().catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { loadBookFiles(bookSlug); }, [bookSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (path: string, name: string, canDelete: boolean) => {
    setSel({ path, name, canDelete });
    setErr(null);
    if (!isText(name)) { setPreview(null); setPreviewMd(false); return; }
    try {
      const text = await fetchText(path);
      setPreviewMd(MD_RE.test(name));
      setPreview(MD_RE.test(name) ? DOMPurify.sanitize(marked.parse(text, { async: false }) as string) : text);
    } catch (e) {
      setPreview(null); setErr(`Couldn't load preview — ${String(e)}`);
    }
  };

  // Upload to the document library. Multipart, so a raw fetch (api() forces JSON);
  // the browser sets the multipart boundary — do NOT set Content-Type.
  const onUpload = async (file: File) => {
    setUploading(true); setErr(null);
    try {
      const t = authToken();
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(apiBase() + '/api/documents/upload', {
        method: 'POST',
        headers: t ? { Authorization: `Bearer ${t}` } : {},
        body: fd,
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => null);
        throw new Error(msg?.error || `${res.status}`);
      }
      await loadDocs();
    } catch (e) {
      setErr(`Upload failed — ${String(e)}`);
    } finally {
      setUploading(false);
    }
  };

  // Download via fetch + Blob so the bearer token stays in the Authorization
  // header (out of the URL / logs / history), matching the preview path.
  const download = async (path: string, name: string) => {
    setErr(null);
    try {
      const t = authToken();
      const sep = path.includes('?') ? '&' : '?';
      const res = await fetch(`${apiBase()}${path}${sep}download=1`, {
        headers: t ? { Authorization: `Bearer ${t}` } : {},
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(`Download failed — ${String(e)}`);
    }
  };

  const del = async () => {
    if (!sel || !sel.canDelete) return;
    if (!confirm(`Delete ${sel.name}? This removes it from disk.`)) return;
    try {
      await api(sel.path, { method: 'DELETE' });
      setSel(null); setPreview(null);
      loadDocs();
    } catch (e) { setErr(`Delete failed — ${String(e)}`); }
  };

  const rows = tab === 'documents' ? docs : bookFiles;

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Files</h1>

      <div className={styles.tabs}>
        <button className={tab === 'documents' ? `${styles.tab} ${styles.on}` : styles.tab} onClick={() => { setTab('documents'); setSel(null); setPreview(null); }}>Documents</button>
        <button className={tab === 'books' ? `${styles.tab} ${styles.on}` : styles.tab} onClick={() => { setTab('books'); setSel(null); setPreview(null); }}>Book outputs</button>
      </div>

      {tab === 'books' && (
        <select className={styles.bookPick} value={bookSlug} onChange={(e) => { setBookSlug(e.target.value); setSel(null); setPreview(null); }}>
          <option value="">Select a book…</option>
          {books.map((b) => <option key={b.slug} value={b.slug}>{b.title}</option>)}
        </select>
      )}

      {tab === 'documents' && (
        <div className={styles.uploadBar}>
          <label className={uploading ? `${styles.uploadBtn} ${styles.uploadBusy}` : styles.uploadBtn}>
            {uploading ? 'Uploading…' : 'Upload document'}
            <input
              type="file"
              accept=".txt,.md,.docx"
              hidden
              disabled={uploading}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }}
            />
          </label>
          <span className={styles.uploadHint}>.txt, .md, or .docx</span>
        </div>
      )}

      {err && <p className={styles.err}>{err}</p>}

      <div className={styles.cols}>
        <div className={styles.list}>
          {rows.length === 0 && (
            <p className={styles.dim}>
              {tab === 'documents' ? 'No documents uploaded.' : bookSlug ? 'No output files yet.' : 'Pick a book to see its outputs.'}
            </p>
          )}
          {rows.map((f) => {
            const path = tab === 'documents'
              ? `/api/documents/${encodeURIComponent(f.name)}`
              : `/api/books/${encodeURIComponent(bookSlug)}/files/${encodeURIComponent(f.name)}`;
            return (
              <button
                key={f.name}
                className={sel?.path === path ? `${styles.row} ${styles.sel}` : styles.row}
                onClick={() => open(path, f.name, tab === 'documents')}
              >
                <span className={styles.fname}>{f.name}</span>
                <span className={styles.fmeta}>{f.meta ?? fmtSize(f.size)}</span>
              </button>
            );
          })}
        </div>

        <div className={styles.preview}>
          {!sel ? (
            <p className={styles.dim}>Select a file to preview.</p>
          ) : (
            <>
              <div className={styles.pvHead}>
                <code className={styles.pvName}>{sel.name}</code>
                <div className={styles.pvActions}>
                  <button className={styles.dl} onClick={() => download(sel.path, sel.name)}>Download</button>
                  {sel.canDelete && <Button variant="secondary" onClick={del}>Delete</Button>}
                </div>
              </div>
              {preview === null ? (
                <p className={styles.dim}>Binary file — use Download to save it.</p>
              ) : previewMd ? (
                <div className={styles.md} dangerouslySetInnerHTML={{ __html: preview }} />
              ) : (
                <pre className={styles.pre}>{preview}</pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
