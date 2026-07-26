import { useEffect, useState, useRef } from 'react';
import { renderMarkdown } from '@bookclaw/shared';
import type { LibraryKind } from '@bookclaw/shared';
import type { Scope } from '../../lib/assetApi.js';
import { readEntry, writeEntry, createLibraryEntry } from '../../lib/assetApi.js';
import { ModelPicker } from './ModelPicker.js';
import { sourceBadge } from '../../lib/sourceBadge.js';
import { useDialog } from '../Dialog.js';
import styles from '../../routes/AssetStudio.module.css';

interface Props {
  scope: Scope;
  kind: LibraryKind;
  name: string;
  displayName?: string;
}

const SINGLE_FILE_KINDS: LibraryKind[] = ['section'];

export function ProseEditor({ scope, kind, name, displayName }: Props) {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [description, setDescription] = useState('');
  // Per-author role-model defaults (author kind only), persisted to meta.json.
  const [sceneBriefModel, setSceneBriefModel] = useState<{ provider?: string; model?: string }>({});
  const [draftModel, setDraftModel] = useState<{ provider?: string; model?: string }>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');
  const { prompt, alert } = useDialog();

  useEffect(() => {
    setError(null);
    setDirty(false);
    setSaveMsg(null);
    readEntry(scope, kind, name)
      .then((entry) => {
        let f: Record<string, string> = {};
        if (entry.files && Object.keys(entry.files).length > 0) {
          f = entry.files;
        } else if (typeof entry.content === 'string') {
          f = { [`${name}.md`]: entry.content };
        }
        setFiles(f);
        const firstFile = Object.keys(f)[0] ?? '';
        setSelectedFile(firstFile);
        setDescription(entry.description ?? '');
        setSceneBriefModel(entry.sceneBriefModel ?? {});
        setDraftModel(entry.draftModel ?? {});
        setSource(entry.source ?? '');
      })
      .catch((e) => setError(String(e)));
  }, [scope, kind, name]);

  const isReadOnly = kind === 'skill';
  const fileNames = Object.keys(files);
  const currentContent = files[selectedFile] ?? '';
  const preview = selectedFile ? renderMarkdown(currentContent) : '';

  function handleContentChange(value: string) {
    setFiles((prev) => ({ ...prev, [selectedFile]: value }));
    setDirty(true);
    setSaveMsg(null);
  }

  function handleDescriptionChange(value: string) {
    setDescription(value);
    setDirty(true);
    setSaveMsg(null);
  }

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const isSingleFile = SINGLE_FILE_KINDS.includes(kind);
      const roleModels = kind === 'author' && scope === 'library'
        ? { sceneBriefModel: { provider: sceneBriefModel.provider ?? '', model: sceneBriefModel.model ?? '' }, draftModel: { provider: draftModel.provider ?? '', model: draftModel.model ?? '' } }
        : {};
      if (isSingleFile) {
        await writeEntry(scope, kind, name, { content: currentContent, description, ...roleModels });
      } else {
        await writeEntry(scope, kind, name, { files, description, ...roleModels });
      }
      setDirty(false);
      setSaveMsg('Saved');
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (e) {
      setSaveMsg(`Error: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate() {
    if (scope !== 'library') return;
    const newName = await prompt({ message: 'Name for the duplicate (lowercase, hyphens only):', defaultValue: `${name}-copy` });
    if (!newName) return;
    try {
      const isSingleFile = SINGLE_FILE_KINDS.includes(kind);
      if (isSingleFile) {
        await createLibraryEntry(kind, newName, { content: currentContent, description });
      } else {
        await createLibraryEntry(kind, newName, { files, description });
      }
    } catch (e) {
      await alert(`Could not duplicate: ${e}`);
    }
  }

  const { cls: srcBadgeCls, label: srcLabel } = sourceBadge(scope, source);
  const srcBadgeClass = styles[srcBadgeCls];

  return (
    <>
      <div className={styles.edhead}>
        <div>
          <h2>{displayName ?? name}</h2>
          <div className={styles.meta}>
            <span className={`${styles.src} ${srcBadgeClass}`}>{srcLabel}</span>
            · {kind}
          </div>
        </div>
        {!isReadOnly && (
          <div className={styles.acts}>
            {scope === 'library' && (
              <button
                onClick={handleDuplicate}
                style={{ display:'inline-flex',alignItems:'center',gap:10,cursor:'pointer',fontFamily:'Hanken Grotesk',fontWeight:600,fontSize:12.5,color:'var(--text)',background:'var(--panel-2)',border:'1px solid var(--line-2)',borderRadius:10,padding:'8px 14px',transition:'.16s' }}
              >
                Duplicate
              </button>
            )}
            <button
              className="btn"
              onClick={handleSave}
              disabled={!dirty || saving}
              style={{ display:'inline-flex',alignItems:'center',gap:8,cursor:dirty&&!saving?'pointer':'not-allowed',fontFamily:'Hanken Grotesk',fontWeight:600,fontSize:13,color:'#1a0f08',background:dirty&&!saving?'linear-gradient(180deg,#f7b15a,#ec8a34)':'var(--panel-2)',border:'1px solid var(--line-2)',borderRadius:10,padding:'9px 15px',opacity:dirty&&!saving?1:0.5 }}
            >
              {saving ? 'Saving…' : saveMsg ?? 'Save'}
            </button>
          </div>
        )}
      </div>

      {error && <div style={{ color: 'var(--alert)', fontSize: 12, marginBottom: 16 }}>{error}</div>}

      {/* Description */}
      <div className={styles.descfield}>
        <div className={styles.fl}>
          Description <em>· shown wherever this asset is listed</em>
        </div>
        <textarea
          className={styles.descbox}
          value={description}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          disabled={isReadOnly}
          rows={2}
          spellCheck={false}
        />
      </div>

      {/* Per-author model defaults: the models this author's books use for the
          scene-brief and first-draft steps. Book board / write screen can override.
          Library scope only — per-book edits go through the book board's model panel,
          which writes the same manifest fields (the template write path here does not
          persist them, so showing the pickers in book scope would be a silent no-op). */}
      {kind === 'author' && scope === 'library' && (
        <div className={styles.descfield} style={{ display: 'grid', gap: 10 }}>
          <div>
            <div className={styles.fl}>Scene-brief model <em>· author default (book or step can override)</em></div>
            <ModelPicker value={sceneBriefModel} onChange={(v) => { setSceneBriefModel({ provider: v.provider, model: v.model }); setDirty(true); setSaveMsg(null); }} hideTemperature />
          </div>
          <div>
            <div className={styles.fl}>First-draft model <em>· author default (book or step can override)</em></div>
            <ModelPicker value={draftModel} onChange={(v) => { setDraftModel({ provider: v.provider, model: v.model }); setDirty(true); setSaveMsg(null); }} hideTemperature />
          </div>
        </div>
      )}

      {isReadOnly ? (
        <div>
          {fileNames.length > 1 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {fileNames.map((f) => (
                <button
                  key={f}
                  onClick={() => setSelectedFile(f)}
                  style={{ padding: '4px 11px', borderRadius: 7, border: '1px solid var(--line-2)', background: selectedFile === f ? 'var(--panel-2)' : 'transparent', color: selectedFile === f ? 'var(--text)' : 'var(--dim)', fontSize: 12, cursor: 'pointer' }}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
          <div style={{ background: 'var(--panel)', borderRadius: 10, padding: '14px 15px', fontSize: 13, color: 'var(--dim)', marginBottom: 16 }}>
            <div dangerouslySetInnerHTML={{ __html: preview }} />
          </div>
          <p style={{ color: 'var(--faint)', fontSize: 12, fontStyle: 'italic', borderLeft: '2px solid var(--line-2)', paddingLeft: 14 }}>
            Skills are edited elsewhere (via /api/skills or the skill files directly).
          </p>
        </div>
      ) : (
        <div>
          {/* File tabs for multi-file kinds */}
          {fileNames.length > 1 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {fileNames.map((f) => (
                <button
                  key={f}
                  onClick={() => setSelectedFile(f)}
                  style={{ padding: '4px 11px', borderRadius: 7, border: '1px solid var(--line-2)', background: selectedFile === f ? 'var(--panel-2)' : 'transparent', color: selectedFile === f ? 'var(--text)' : 'var(--dim)', fontSize: 12, cursor: 'pointer' }}
                >
                  {f}
                </button>
              ))}
            </div>
          )}
          {/* Two-column markdown editor */}
          <div className={styles.md}>
            <div className={styles.col}>
              <div className={styles.fl}>Markdown source</div>
              <textarea
                className={styles.raw}
                value={currentContent}
                onChange={(e) => handleContentChange(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className={styles.col}>
              <div className={styles.fl}>Preview</div>
              {/* Book-scope content can be imported from untrusted .zip archives — sanitize before render. */}
              <div className={styles.prev} dangerouslySetInnerHTML={{ __html: preview }} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
