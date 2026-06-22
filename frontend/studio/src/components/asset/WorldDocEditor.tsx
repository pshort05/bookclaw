import { useEffect, useState } from 'react';
import type { LibraryWorld, WorldDocMeta } from '@bookclaw/shared';
import { getWorldDoc, createWorldDoc, updateWorldDoc, deleteWorldDoc } from '../../lib/worldApi.js';
import { useDialog } from '../Dialog.js';
import asset from '../../routes/AssetStudio.module.css';
import w from './World.module.css';

const inputStyle = { width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'Hanken Grotesk' } as const;

interface Props {
  world: string;
  config: LibraryWorld;
  docId: string | 'new';
  readOnly: boolean;
  onDone: (changed: boolean) => void;
}

/** Create/edit a single world document — frontmatter form + body. */
export function WorldDocEditor({ world, config, docId, readOnly, onDone }: Props) {
  const isNew = docId === 'new';
  const { confirm } = useDialog();

  const [title, setTitle] = useState('');
  const [type, setType] = useState(config.documentTypes[0]?.id ?? '');
  const [domain, setDomain] = useState(config.domains[0] ?? '');
  const [clearance, setClearance] = useState(config.clearanceLevels[0] ?? '');
  const [attribution, setAttribution] = useState('');
  const [tagsRaw, setTagsRaw] = useState('');
  const [summary, setSummary] = useState('');
  const [apxEligible, setApxEligible] = useState(false);
  const [classification, setClassification] = useState('');
  const [body, setBody] = useState('');

  const [loaded, setLoaded] = useState(isNew);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) { setLoaded(true); return; }
    let cancelled = false;
    setError(null); setLoaded(false);
    getWorldDoc(world, docId)
      .then((doc) => {
        if (cancelled) return;
        const m = doc.meta;
        setTitle(m.title ?? '');
        setType(m.type ?? '');
        setDomain(m.domain ?? '');
        setClearance(m.clearance ?? '');
        setAttribution(m.attribution ?? '');
        setTagsRaw((m.tags ?? []).join(', '));
        setSummary(m.summary ?? '');
        setApxEligible(!!m.appendixEligible);
        setClassification(m.classification ?? '');
        setBody(doc.body ?? '');
        setLoaded(true);
      })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [world, docId]);

  async function save() {
    if (saving || readOnly) return;
    setSaving(true); setMsg(null);
    const meta = {
      title: title.trim(),
      type,
      domain,
      clearance,
      attribution: attribution.trim() || undefined,
      tags: tagsRaw.split(',').map((t) => t.trim()).filter(Boolean),
      summary: summary.trim(),
      appendixEligible: apxEligible || undefined,
    };
    try {
      if (isNew) {
        await createWorldDoc(world, { meta, body });
      } else {
        await updateWorldDoc(world, docId, { meta: { ...meta, classification } as WorldDocMeta, body });
      }
      onDone(true);
    } catch (e) {
      setMsg(`Error: ${e}`);
      setSaving(false);
    }
  }

  async function remove() {
    if (isNew || readOnly) return;
    if (!(await confirm(`Delete "${title || docId}"? This cannot be undone.`))) return;
    setSaving(true); setMsg(null);
    try {
      await deleteWorldDoc(world, docId);
      onDone(true);
    } catch (e) {
      setMsg(`Error: ${e}`);
      setSaving(false);
    }
  }

  if (error) return <div style={{ color: 'var(--alert)', fontSize: 13 }}>{error}</div>;
  if (!loaded) return <div style={{ color: 'var(--faint)', fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: '70ch' }}>
      <button className={w.back} onClick={() => onDone(false)}>← Back to documents</button>

      <div className={asset.edhead}>
        <div>
          <h2>{isNew ? 'New document' : (title || docId)}</h2>
          <div className={asset.meta}>{config.label ?? world}{readOnly ? ' · read-only' : ''}</div>
        </div>
        {!readOnly && (
          <div className={asset.acts}>
            {!isNew && (
              <button className={w.tab} onClick={remove} disabled={saving}>Delete</button>
            )}
            <button
              onClick={save}
              disabled={saving}
              style={{ cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'Hanken Grotesk', fontWeight: 600, fontSize: 13, color: '#1a0f08', background: saving ? 'var(--panel-2)' : 'linear-gradient(180deg,#f7b15a,#ec8a34)', border: '1px solid var(--line-2)', borderRadius: 10, padding: '9px 15px', opacity: saving ? 0.5 : 1 }}
            >
              {saving ? 'Saving…' : msg ?? 'Save'}
            </button>
          </div>
        )}
      </div>

      {msg && <div style={{ color: 'var(--alert)', fontSize: 12, marginBottom: 12 }}>{msg}</div>}

      <div className={asset.descfield}>
        <div className={asset.fl}>Title</div>
        <input style={inputStyle} value={title} disabled={readOnly} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div style={{ display: 'flex', gap: 14 }}>
        <div className={asset.descfield} style={{ flex: 1 }}>
          <div className={asset.fl}>Type</div>
          <select style={inputStyle} value={type} disabled={readOnly} onChange={(e) => setType(e.target.value)}>
            {config.documentTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div className={asset.descfield} style={{ flex: 1 }}>
          <div className={asset.fl}>Domain</div>
          <select style={inputStyle} value={domain} disabled={readOnly} onChange={(e) => setDomain(e.target.value)}>
            {config.domains.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className={asset.descfield} style={{ flex: 1 }}>
          <div className={asset.fl}>Clearance</div>
          <select style={inputStyle} value={clearance} disabled={readOnly} onChange={(e) => setClearance(e.target.value)}>
            {config.clearanceLevels.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className={asset.descfield}>
        <div className={asset.fl}>Classification</div>
        <input style={{ ...inputStyle, color: 'var(--dim)' }} value={isNew ? 'auto-assigned on save' : classification} readOnly />
      </div>

      <div className={asset.descfield}>
        <div className={asset.fl}>Attribution <em>· optional</em></div>
        <input style={inputStyle} value={attribution} disabled={readOnly} onChange={(e) => setAttribution(e.target.value)} />
      </div>

      <div className={asset.descfield}>
        <div className={asset.fl}>Tags <em>· comma-separated</em></div>
        <input style={inputStyle} value={tagsRaw} disabled={readOnly} onChange={(e) => setTagsRaw(e.target.value)} />
      </div>

      <div className={asset.descfield}>
        <div className={asset.fl}>Summary</div>
        <textarea className={asset.descbox} rows={3} value={summary} disabled={readOnly} onChange={(e) => setSummary(e.target.value)} />
      </div>

      <div className={asset.descfield}>
        <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13, color: 'var(--text)' }}>
          <input type="checkbox" checked={apxEligible} disabled={readOnly} onChange={(e) => setApxEligible(e.target.checked)} />
          Appendix-eligible <em style={{ color: 'var(--faint)' }}>· can be selected as reader-facing back-matter</em>
        </label>
      </div>

      <div className={asset.descfield}>
        <div className={asset.fl}>Body</div>
        <textarea
          value={body}
          disabled={readOnly}
          onChange={(e) => setBody(e.target.value)}
          rows={22}
          spellCheck={false}
          style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 10, padding: '14px 15px', color: 'var(--text)', fontSize: 13, fontFamily: 'Fraunces, serif', lineHeight: 1.6, resize: 'vertical' }}
        />
      </div>
    </div>
  );
}
