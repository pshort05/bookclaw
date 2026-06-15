import { useEffect, useState } from 'react';
import { api } from '@bookclaw/shared';
import type { LibraryKind } from '@bookclaw/shared';
import type { Scope } from '../../lib/assetApi.js';
import { readEntry, writeEntry } from '../../lib/assetApi.js';
import { sourceBadge } from '../../lib/sourceBadge.js';
import styles from '../../routes/AssetStudio.module.css';

interface Props {
  scope: Scope;
  kind: LibraryKind;
  name: string;
  displayName?: string;
}

interface SequenceData {
  schemaVersion?: number;
  name?: string;
  label?: string;
  description?: string;
  pipelines: string[];
}

/**
 * Sequence editor (config-not-code pipelines, Task 14). A sequence is an ordered
 * list of pipeline names a book runs back-to-back. Mirrors PipelineEditor's
 * load/save/scope conventions; serializes to { schemaVersion, name, label,
 * description, pipelines:[...] } via the same library write path.
 */
export function SequenceEditor({ scope, kind, name, displayName }: Props) {
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [pipelines, setPipelines] = useState<string[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [addPick, setAddPick] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');

  useEffect(() => {
    setError(null); setDirty(false); setSaveMsg(null); setLoaded(false);
    readEntry(scope, kind, name)
      .then((entry) => {
        let seq: SequenceData | null = null;
        if (typeof entry.content === 'string' && entry.content.trim()) {
          try { seq = JSON.parse(entry.content); } catch { /* handled below */ }
        }
        if (!seq || !Array.isArray(seq.pipelines)) {
          setError('Could not load this sequence (invalid or empty JSON).');
          return;
        }
        setLabel(seq.label ?? '');
        setDescription(entry.description ?? seq.description ?? '');
        setPipelines(seq.pipelines.filter((p) => typeof p === 'string'));
        setSource(entry.source ?? '');
        setLoaded(true);
      })
      .catch((e) => setError(String(e)));
    // Available pipelines to add into the sequence.
    api<{ entries: Array<{ name: string }> }>('/api/library/pipeline')
      .then((r) => setAvailable((r.entries ?? []).map((e) => e.name)))
      .catch(() => {});
  }, [scope, kind, name]);

  function mark() { setDirty(true); setSaveMsg(null); }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= pipelines.length) return;
    const next = [...pipelines];
    [next[i], next[j]] = [next[j], next[i]];
    setPipelines(next); mark();
  }

  function remove(i: number) {
    setPipelines((xs) => xs.filter((_, idx) => idx !== i)); mark();
  }

  function add() {
    if (!addPick) return;
    setPipelines((xs) => [...xs, addPick]);
    setAddPick('');
    mark();
  }

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true); setSaveMsg(null);
    try {
      const serialized = JSON.stringify(
        { schemaVersion: 1, name, label: label.trim() || name, description, pipelines },
        null, 2,
      );
      await writeEntry(scope, kind, name, { content: serialized });
      setDirty(false); setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (e) {
      setSaveMsg(`Error: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  if (error) return <div style={{ color: 'var(--alert)', fontSize: 13 }}>{error}</div>;
  if (!loaded) return <div style={{ color: 'var(--faint)', fontSize: 13 }}>Loading…</div>;

  const { cls: srcBadgeCls, label: srcLabel } = sourceBadge(scope, source);
  const srcBadgeClass = styles[srcBadgeCls];
  const inputStyle = { width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'Hanken Grotesk' } as const;

  return (
    <>
      <div className={styles.edhead}>
        <div>
          <h2>{displayName ?? name}</h2>
          <div className={styles.meta}>
            <span className={`${styles.src} ${srcBadgeClass}`}>{srcLabel}</span>
            · Sequence · {pipelines.length} pipeline{pipelines.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className={styles.acts}>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            style={{ display:'inline-flex',alignItems:'center',gap:8,cursor:dirty&&!saving?'pointer':'not-allowed',fontFamily:'Hanken Grotesk',fontWeight:600,fontSize:13,color:'#1a0f08',background:dirty&&!saving?'linear-gradient(180deg,#f7b15a,#ec8a34)':'var(--panel-2)',border:'1px solid var(--line-2)',borderRadius:10,padding:'9px 15px',opacity:dirty&&!saving?1:0.5 }}
          >
            {saving ? 'Saving…' : saveMsg ?? 'Save'}
          </button>
        </div>
      </div>

      {/* Label */}
      <div className={styles.descfield}>
        <div className={styles.fl}>Label <em>· display name for this sequence</em></div>
        <input style={inputStyle} value={label} onChange={(e) => { setLabel(e.target.value); mark(); }} />
      </div>

      {/* Description */}
      <div className={styles.descfield}>
        <div className={styles.fl}>Description <em>· shown wherever this sequence is listed</em></div>
        <textarea
          className={styles.descbox}
          value={description}
          onChange={(e) => { setDescription(e.target.value); mark(); }}
          rows={2}
          spellCheck={false}
        />
      </div>

      <p style={{ color: 'var(--dim)', fontSize: 13, margin: '0 0 22px', maxWidth: '64ch' }}>
        An ordered list of pipelines a book runs in sequence. Reorder, add, or remove pipelines — a book created from this sequence runs them back-to-back.
      </p>

      <div className={styles.steplbl}>
        Pipelines <span className={styles.hr} />
        {pipelines.length}
      </div>

      {pipelines.map((p, i) => (
        <div key={`${p}-${i}`} className={styles.step}>
          <div className={styles.srow} style={{ cursor: 'default' }}>
            <span className={styles.snum}>{i + 1}</span>
            <span className={styles.sname}>{p}</span>
            <span className={styles.sctrl} style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => move(i, -1)}
                disabled={i === 0}
                title="Move up"
                style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--dim)', cursor: i === 0 ? 'not-allowed' : 'pointer', opacity: i === 0 ? 0.4 : 1 }}
              >↑</button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === pipelines.length - 1}
                title="Move down"
                style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--dim)', cursor: i === pipelines.length - 1 ? 'not-allowed' : 'pointer', opacity: i === pipelines.length - 1 ? 0.4 : 1 }}
              >↓</button>
              <button
                onClick={() => remove(i)}
                title="Remove pipeline"
                style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--alert)', cursor: 'pointer' }}
              >Remove</button>
            </span>
          </div>
        </div>
      ))}

      {pipelines.length === 0 && (
        <p style={{ color: 'var(--faint)', fontSize: 13 }}>No pipelines yet — add one below.</p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 18, alignItems: 'center' }}>
        <select
          value={addPick}
          onChange={(e) => setAddPick(e.target.value)}
          style={{ flex: 1, background: 'var(--panel)', border: '1px solid var(--line-2)', borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'Hanken Grotesk' }}
        >
          <option value="">— pick a pipeline to add —</option>
          {available.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button
          onClick={add}
          disabled={!addPick}
          style={{ padding: '9px 15px', borderRadius: 10, border: '1px solid var(--line-2)', background: 'var(--panel-2)', color: 'var(--text)', fontSize: 13, fontFamily: 'Hanken Grotesk', fontWeight: 600, cursor: addPick ? 'pointer' : 'not-allowed', opacity: addPick ? 1 : 0.5 }}
        >Add pipeline</button>
      </div>
    </>
  );
}
