import { useEffect, useState } from 'react';
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

interface EditorData {
  schemaVersion?: number;
  name?: string;
  label?: string;
  description?: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
}

/**
 * Editor editor — an interactive developmental-editor persona (a JSON `editor`
 * library kind). Mirrors PipelineEditor/SequenceEditor's load/save/scope
 * conventions; serializes to { schemaVersion, name, label, description,
 * systemPrompt, model, temperature } via the same library write path.
 */
export function EditorEditor({ scope, kind, name, displayName }: Props) {
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState('');
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
        let ed: EditorData | null = null;
        if (entry.editor) {
          ed = entry.editor;
        } else if (typeof entry.content === 'string' && entry.content.trim()) {
          try { ed = JSON.parse(entry.content); } catch { /* handled below */ }
        }
        if (!ed) {
          setError('Could not load this editor (invalid or empty JSON).');
          return;
        }
        setLabel(ed.label ?? '');
        setDescription(entry.description ?? ed.description ?? '');
        setSystemPrompt(ed.systemPrompt ?? '');
        setModel(ed.model ?? '');
        setTemperature(typeof ed.temperature === 'number' ? String(ed.temperature) : '');
        setSource(entry.source ?? '');
        setLoaded(true);
      })
      .catch((e) => setError(String(e)));
  }, [scope, kind, name]);

  function mark() { setDirty(true); setSaveMsg(null); }

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true); setSaveMsg(null);
    try {
      const temp = temperature.trim();
      const payload: EditorData = {
        schemaVersion: 1,
        name,
        label: label.trim() || name,
        description,
        systemPrompt,
      };
      if (model.trim()) payload.model = model.trim();
      if (temp !== '' && !Number.isNaN(Number(temp))) payload.temperature = Number(temp);
      const serialized = JSON.stringify(payload, null, 2);
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
            · Editor
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
        <div className={styles.fl}>Label <em>· display name for this editor</em></div>
        <input style={inputStyle} value={label} onChange={(e) => { setLabel(e.target.value); mark(); }} />
      </div>

      {/* Description */}
      <div className={styles.descfield}>
        <div className={styles.fl}>Description <em>· shown wherever this editor is listed</em></div>
        <textarea
          className={styles.descbox}
          value={description}
          onChange={(e) => { setDescription(e.target.value); mark(); }}
          rows={2}
          spellCheck={false}
        />
      </div>

      <p style={{ color: 'var(--dim)', fontSize: 13, margin: '0 0 22px', maxWidth: '64ch' }}>
        An interactive developmental-editor persona you chat with to finetune ideas. The system prompt defines how this editor behaves in conversation; it replaces the author voice while the channel is in editor mode.
      </p>

      {/* Model + temperature */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 18 }}>
        <div className={styles.descfield} style={{ flex: 1 }}>
          <div className={styles.fl}>Model <em>· optional OpenRouter model override</em></div>
          <input style={inputStyle} value={model} onChange={(e) => { setModel(e.target.value); mark(); }} placeholder="— default routing —" />
        </div>
        <div className={styles.descfield} style={{ width: 200 }}>
          <div className={styles.fl}>Temperature <em>· 0–2</em></div>
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            style={inputStyle}
            value={temperature}
            onChange={(e) => { setTemperature(e.target.value); mark(); }}
            placeholder="—"
          />
        </div>
      </div>

      {/* System prompt */}
      <div className={styles.descfield}>
        <div className={styles.fl}>System prompt <em>· defines the editor's persona and behaviour</em></div>
        <textarea
          value={systemPrompt}
          onChange={(e) => { setSystemPrompt(e.target.value); mark(); }}
          rows={20}
          spellCheck={false}
          style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 10, padding: '14px 15px', color: 'var(--text)', fontSize: 13, fontFamily: 'Fraunces, serif', lineHeight: 1.6, resize: 'vertical' }}
        />
      </div>
    </>
  );
}
