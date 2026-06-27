import { useEffect, useState, useCallback } from 'react';
import { api, apiBase, authToken, useStore, useActiveBook } from '@bookclaw/shared';
import type { LibraryEntry } from '@bookclaw/shared';
import { useDialog } from '../components/Dialog.js';
import { AI_PROVIDERS, PROVIDER_DEFAULT_MODEL } from '../lib/providers.js';
import { useOpenRouterModels } from '../lib/openrouterModels.js';
import styles from './PromptRunner.module.css';

interface RunnerFile { path: string; group: 'Outputs' | 'Templates'; bytes: number; modified?: string }
interface Version { id: string; at: string; bytes: number }
interface RunMeta {
  provider: string;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  tokensUsed: number;
  estimatedCost: number;
  ms: number;
  tokensPerSecond?: number;
}

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
  const books = useStore((s) => s.books);
  const activeBook = useActiveBook();

  // The runner targets ANY book, not just the active one. Default to the active
  // book once books load; the user can switch via the Book selector.
  const [slug, setSlug] = useState('');
  useEffect(() => {
    if (!slug && books.length) setSlug(activeBook?.slug ?? books[0].slug);
  }, [books, activeBook, slug]);
  const book = books.find((b) => b.slug === slug);

  const [files, setFiles] = useState<RunnerFile[]>([]);
  const [prompts, setPrompts] = useState<LibraryEntry[]>([]);
  const [file, setFile] = useState('');   // book-root path: data/… or templates/…
  const [promptName, setPromptName] = useState('');

  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  // OpenRouter catalog for the exact-model picker (lazy-fetched when provider is
  // openrouter; gateway-cached 24h). Fail-soft to free-text.
  const orModels = useOpenRouterModels(provider);

  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [meta, setMeta] = useState<RunMeta | null>(null);
  // The prompt/file the current output was actually produced from — captured at
  // run time so a later dropdown change can't mislabel a saved report.
  const [lastRun, setLastRun] = useState<{ prompt: string; file: string } | null>(null);
  const [original, setOriginal] = useState('');   // the file text we sent in (for the diff)
  const [showDiff, setShowDiff] = useState(false);

  const [versions, setVersions] = useState<Version[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { prompt, confirm } = useDialog();

  useEffect(() => { loadBooks().catch(() => {}); }, [loadBooks]);

  const loadFiles = useCallback(() => {
    if (!slug) { setFiles([]); return; }
    api<{ files: RunnerFile[] }>(`/api/books/${encodeURIComponent(slug)}/runner-files`)
      .then((r) => setFiles(r.files ?? []))
      .catch((e) => setErr(String(e)));
  }, [slug]);

  // File list for the selected book; reset the file selection when the book changes.
  useEffect(() => { setFile(''); loadFiles(); }, [loadFiles]);

  // Prompt catalog.
  useEffect(() => {
    api<{ entries: LibraryEntry[] }>('/api/library?kind=prompt')
      .then((r) => setPrompts(r.entries ?? []))
      .catch((e) => setErr(String(e)));
  }, []);

  const loadVersions = useCallback(() => {
    if (!slug || !file) { setVersions([]); return; }
    api<{ versions: Version[] }>(`/api/books/${encodeURIComponent(slug)}/file/versions?path=${encodeURIComponent(file)}`)
      .then((r) => setVersions(r.versions ?? []))
      .catch(() => setVersions([]));
  }, [slug, file]);

  // Reset run state + reload versions whenever the selected file changes.
  useEffect(() => {
    setOutput(null); setMeta(null); setLastRun(null); setShowDiff(false); setOriginal(''); setMsg(null); setErr(null);
    loadVersions();
  }, [loadVersions]);

  const selectedPrompt = prompts.find((p) => p.name === promptName);
  const canRun = !!(slug && file && promptName) && !running;
  const outputs = files.filter((f) => f.group === 'Outputs');
  const templates = files.filter((f) => f.group === 'Templates');

  async function run() {
    if (!canRun) return;
    setRunning(true); setErr(null); setMsg(null); setOutput(null); setMeta(null); setLastRun(null); setShowDiff(false);
    try {
      const text = await fetchText(`/api/books/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(file)}`);
      setOriginal(text);
      const r = await api<{ output: string; meta?: RunMeta }>('/api/prompts/run', {
        method: 'POST',
        body: JSON.stringify({ prompt: promptName, content: text, bookSlug: slug, provider: provider || undefined, model: model || undefined }),
      });
      setOutput(r.output ?? '');
      setMeta(r.meta ?? null);
      setLastRun({ prompt: promptName, file });
    } catch (e) {
      setErr(`Run failed — ${String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  async function writeFile(path: string, content: string) {
    await api(`/api/books/${encodeURIComponent(slug)}/file`, {
      method: 'PUT', body: JSON.stringify({ path, content }),
    });
  }

  async function confirmReplace() {
    if (output === null) return;
    try {
      await writeFile(file, output);
      setShowDiff(false); setOutput(null); setMeta(null);
      setMsg(`Replaced ${file}.`);
      loadVersions();
    } catch (e) { setErr(`Replace failed — ${String(e)}`); }
  }

  async function saveAsNew() {
    if (output === null) return;
    const name = await prompt('Save output as new file (e.g. chapter-1-revised.md):');
    if (!name) return;
    // New files always land in the book's data/ outputs.
    const path = `data/${name.replace(/^data\//, '')}`;
    try {
      await writeFile(path, output);
      setMsg(`Saved as ${path}.`);
      loadFiles();   // reflect the new file in the picker
    } catch (e) { setErr(`Save failed — ${String(e)}`); }
  }

  async function saveAsReport() {
    // Guard empty output (a run can return '') and attribute to the run that
    // produced this output (lastRun), not the possibly-changed dropdowns.
    if (!output || !lastRun) return;
    try {
      const r = await api<{ id: string }>(`/api/books/${encodeURIComponent(slug)}/prompts/report`, {
        method: 'POST',
        body: JSON.stringify({ prompt: lastRun.prompt, file: lastRun.file, output, meta }),
      });
      setMsg(`Saved report ${r.id} — view it on the Reports page.`);
    } catch (e) { setErr(`Save report failed — ${String(e)}`); }
  }

  function discard() {
    setOutput(null); setMeta(null); setLastRun(null); setShowDiff(false); setOriginal('');
  }

  async function restore(id: string) {
    if (!(await confirm('Restore this version? The current file is snapshotted first.'))) return;
    try {
      await api(`/api/books/${encodeURIComponent(slug)}/file/restore`, {
        method: 'POST', body: JSON.stringify({ path: file, id }),
      });
      setMsg('Restored.');
      loadVersions();
    } catch (e) { setErr(`Restore failed — ${String(e)}`); }
  }

  return (
    <div className={styles.scroll}>
      <h1 className={styles.h1}>Prompt Runner</h1>
      <p className={styles.sub}>
        {books.length
          ? <>Run a writing-craft prompt against any file in a book — outputs or template snapshots.</>
          : <>No books yet — create one on the Book Board first.</>}
      </p>

      {err && <p className={styles.err}>{err}</p>}
      {msg && <p className={styles.dim}>{msg}</p>}

      <div className={styles.cols}>
        <div className={styles.left}>
          <div className={styles.field}>
            <span className={styles.fl}>Book</span>
            <select className={styles.pick} value={slug} onChange={(e) => setSlug(e.target.value)} disabled={running}>
              <option value="">Select a book…</option>
              {books.map((b) => <option key={b.slug} value={b.slug}>{b.title}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <span className={styles.fl}>File</span>
            <select className={styles.pick} value={file} onChange={(e) => setFile(e.target.value)} disabled={!slug || running}>
              <option value="">Select a file…</option>
              {outputs.length > 0 && (
                <optgroup label="Outputs">
                  {outputs.map((f) => <option key={f.path} value={f.path}>{f.path.replace(/^data\//, '')}</option>)}
                </optgroup>
              )}
              {templates.length > 0 && (
                <optgroup label="Templates">
                  {templates.map((f) => <option key={f.path} value={f.path}>{f.path.replace(/^templates\//, '')}</option>)}
                </optgroup>
              )}
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

          <div className={styles.field}>
            <span className={styles.fl}>Model</span>
            <select className={styles.pick} value={provider} onChange={(e) => { setProvider(e.target.value); if (!e.target.value) setModel(''); }} disabled={running}>
              <option value="">default (auto)</option>
              {AI_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          {provider !== '' && (
            <div className={styles.field}>
              <span className={styles.fl}>Exact model</span>
              <input
                className={styles.pick}
                type="text"
                list={provider === 'openrouter' ? 'openrouter-models' : undefined}
                value={model}
                placeholder={PROVIDER_DEFAULT_MODEL[provider]}
                onChange={(e) => setModel(e.target.value)}
                disabled={running}
              />
              {provider === 'openrouter' && (
                <datalist id="openrouter-models">
                  {orModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </datalist>
              )}
            </div>
          )}

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
            <div className={styles.dim}>Select a book, a file, and a prompt, then Run.</div>
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
                  <button className={styles.act} onClick={saveAsReport} disabled={!output || !lastRun}>Save as report</button>
                  <button className={styles.act} onClick={discard}>Discard</button>
                </div>
              </div>
              {meta && (() => {
                const parts: string[] = [];
                parts.push(`${(meta.ms / 1000).toFixed(1)}s`);
                let tokStr = meta.tokensUsed.toLocaleString() + ' tokens';
                if (meta.promptTokens != null && meta.completionTokens != null) {
                  tokStr += ` (${meta.promptTokens.toLocaleString()} prompt + ${meta.completionTokens.toLocaleString()} completion)`;
                }
                parts.push(tokStr);
                if (meta.tokensPerSecond != null && isFinite(meta.tokensPerSecond)) {
                  parts.push(`~${meta.tokensPerSecond.toFixed(1)} tok/s (est.)`);
                }
                parts.push(`${meta.provider}${meta.model ? '/' + meta.model : ''}`);
                parts.push(`~$${meta.estimatedCost.toFixed(4)} (est.)`);
                return <div className={styles.vmeta} style={{ marginBottom: 10 }}>{parts.join(' · ')}</div>;
              })()}
              <pre className={styles.pre}>{output}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
