import { useEffect, useState, useCallback } from 'react';
import { api, apiBase, authToken, useStore, useActiveBook } from '@bookclaw/shared';
import type { LibraryEntry } from '@bookclaw/shared';
import styles from './PromptRunner.module.css';

interface FileRow { name: string; bytes: number; modified?: string }
interface Version { id: string; at: string; bytes: number }

// The runner sends file text in and writes file text back; api() parses JSON,
// so fetch the raw body directly (with the bearer header), matching Files.tsx.
async function fetchText(path: string): Promise<string> {
  const t = authToken();
  const res = await fetch(apiBase() + path, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.text();
}

export function PromptRunner() {
  const loadBooks = useStore((s) => s.loadBooks);
  const activeBook = useActiveBook();
  const slug = activeBook?.slug ?? '';

  const [files, setFiles] = useState<FileRow[]>([]);
  const [prompts, setPrompts] = useState<LibraryEntry[]>([]);
  const [file, setFile] = useState('');
  const [promptName, setPromptName] = useState('');

  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [original, setOriginal] = useState('');   // the file text we sent in (for the diff)
  const [showDiff, setShowDiff] = useState(false);

  const [versions, setVersions] = useState<Version[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { loadBooks().catch(() => {}); }, [loadBooks]);

  // File list for the active book.
  useEffect(() => {
    if (!slug) { setFiles([]); return; }
    api<{ files: FileRow[] }>(`/api/books/${encodeURIComponent(slug)}/files`)
      .then((r) => setFiles(r.files ?? []))
      .catch((e) => setErr(String(e)));
  }, [slug]);

  // Prompt catalog.
  useEffect(() => {
    api<{ entries: LibraryEntry[] }>('/api/library?kind=prompt')
      .then((r) => setPrompts(r.entries ?? []))
      .catch((e) => setErr(String(e)));
  }, []);

  const loadVersions = useCallback(() => {
    if (!slug || !file) { setVersions([]); return; }
    api<{ versions: Version[] }>(`/api/books/${encodeURIComponent(slug)}/files/${encodeURIComponent(file)}/versions`)
      .then((r) => setVersions(r.versions ?? []))
      .catch(() => setVersions([]));
  }, [slug, file]);

  // Reset run state + reload versions whenever the selected file changes.
  useEffect(() => {
    setOutput(null); setShowDiff(false); setOriginal(''); setMsg(null); setErr(null);
    loadVersions();
  }, [loadVersions]);

  const selectedPrompt = prompts.find((p) => p.name === promptName);
  const canRun = !!(slug && file && promptName) && !running;

  async function run() {
    if (!canRun) return;
    setRunning(true); setErr(null); setMsg(null); setOutput(null); setShowDiff(false);
    try {
      const text = await fetchText(`/api/books/${encodeURIComponent(slug)}/files/${encodeURIComponent(file)}`);
      setOriginal(text);
      const r = await api<{ output: string }>('/api/prompts/run', {
        method: 'POST',
        body: JSON.stringify({ prompt: promptName, content: text, bookSlug: slug }),
      });
      setOutput(r.output ?? '');
    } catch (e) {
      setErr(`Run failed — ${String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  async function writeFile(name: string, content: string) {
    await api(`/api/books/${encodeURIComponent(slug)}/files/${encodeURIComponent(name)}`, {
      method: 'PUT', body: JSON.stringify({ content }),
    });
  }

  async function confirmReplace() {
    if (output === null) return;
    try {
      await writeFile(file, output);
      setShowDiff(false); setOutput(null);
      setMsg(`Replaced ${file}.`);
      loadVersions();
    } catch (e) { setErr(`Replace failed — ${String(e)}`); }
  }

  async function saveAsNew() {
    if (output === null) return;
    const name = window.prompt('Save output as new file (e.g. chapter-1-revised.md):');
    if (!name) return;
    try {
      await writeFile(name, output);
      setMsg(`Saved as ${name}.`);
      // Reflect the new file in the picker.
      api<{ files: FileRow[] }>(`/api/books/${encodeURIComponent(slug)}/files`)
        .then((r) => setFiles(r.files ?? [])).catch(() => {});
    } catch (e) { setErr(`Save failed — ${String(e)}`); }
  }

  function discard() {
    setOutput(null); setShowDiff(false); setOriginal('');
  }

  async function restore(id: string) {
    if (!window.confirm('Restore this version? The current file is snapshotted first.')) return;
    try {
      await api(`/api/books/${encodeURIComponent(slug)}/files/${encodeURIComponent(file)}/restore`, {
        method: 'POST', body: JSON.stringify({ id }),
      });
      setMsg('Restored.');
      loadVersions();
    } catch (e) { setErr(`Restore failed — ${String(e)}`); }
  }

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Prompt Runner</h1>
      <p className={styles.sub}>
        {activeBook
          ? <>Run a writing-craft prompt against a file in <b>{activeBook.title}</b>.</>
          : <>No active book — set one on the Book Board first.</>}
      </p>

      {err && <p className={styles.err}>{err}</p>}
      {msg && <p className={styles.dim}>{msg}</p>}

      <div className={styles.cols}>
        <div className={styles.left}>
          <div className={styles.field}>
            <span className={styles.fl}>File</span>
            <select className={styles.pick} value={file} onChange={(e) => setFile(e.target.value)} disabled={!slug}>
              <option value="">Select a file…</option>
              {files.map((f) => <option key={f.name} value={f.name}>{f.name}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <span className={styles.fl}>Prompt</span>
            <select className={styles.pick} value={promptName} onChange={(e) => setPromptName(e.target.value)}>
              <option value="">Select a prompt…</option>
              {prompts.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
            {selectedPrompt?.description && <div className={styles.pdesc}>{selectedPrompt.description}</div>}
          </div>

          <button className={styles.runBtn} onClick={run} disabled={!canRun}>
            {running ? 'Running…' : 'Run'}
          </button>

          {file && (
            <div className={styles.versions}>
              <h3>Version history</h3>
              {versions.length === 0
                ? <div className={styles.dim}>No prior versions.</div>
                : versions.map((v) => (
                  <div key={v.id} className={styles.vrow}>
                    <span className={styles.vmeta}>{new Date(v.at).toLocaleString()} · {v.bytes} B</span>
                    <button className={styles.vbtn} onClick={() => restore(v.id)}>Restore</button>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div className={styles.out}>
          {running ? (
            <div className={styles.spinner}>Running the prompt…</div>
          ) : output === null ? (
            <div className={styles.dim}>Select a file and a prompt, then Run.</div>
          ) : showDiff ? (
            <>
              <div className={styles.outHead}>
                <span className={styles.outTitle}>Replace {file}?</span>
                <div className={styles.outActions}>
                  <button className={styles.act} onClick={confirmReplace}>Confirm replace</button>
                  <button className={styles.act} onClick={() => setShowDiff(false)}>Back</button>
                </div>
              </div>
              <div className={styles.diffCols}>
                <div className={styles.diffCol}>
                  <h4>Original</h4>
                  <pre className={styles.diffPre}>{original}</pre>
                </div>
                <div className={styles.diffCol}>
                  <h4>New (output)</h4>
                  <pre className={styles.diffPre}>{output}</pre>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className={styles.outHead}>
                <span className={styles.outTitle}>Output</span>
                <div className={styles.outActions}>
                  <button className={styles.act} onClick={() => setShowDiff(true)}>Replace…</button>
                  <button className={styles.act} onClick={saveAsNew}>Save as new file</button>
                  <button className={styles.act} onClick={discard}>Discard</button>
                </div>
              </div>
              <pre className={styles.pre}>{output}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
