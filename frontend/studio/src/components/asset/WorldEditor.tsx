import { useEffect, useState } from 'react';
import type { LibraryWorld, WorldDocCatalogRow, WorldDocumentType } from '@bookclaw/shared';
import type { Scope } from '../../lib/assetApi.js';
import { writeEntry } from '../../lib/assetApi.js';
import { getWorldConfig, listWorldDocs } from '../../lib/worldApi.js';
import { groupDocs } from '../../lib/worldGroup.js';
import { sourceBadge } from '../../lib/sourceBadge.js';
import { WorldDocEditor } from './WorldDocEditor.js';
import asset from '../../routes/AssetStudio.module.css';
import w from './World.module.css';

const inputStyle = { width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'Hanken Grotesk' } as const;

// Map a clearance string to a badge tint by position in the (ordered) levels —
// low index = open, high = restricted.
function clrClass(clearance: string, levels: string[]): string {
  const i = levels.indexOf(clearance);
  if (i < 0) return w.clrGeneral;
  if (i >= levels.length - 1) return w.clrRestricted;
  return i === 0 ? w.clrGeneral : w.clrMid;
}

export function WorldEditor({ scope, name }: { scope: Scope; name: string }) {
  const [config, setConfig] = useState<LibraryWorld | null>(null);
  const [rows, setRows] = useState<WorldDocCatalogRow[]>([]);
  const [tab, setTab] = useState<'docs' | 'config'>('docs');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const readOnly = scope === 'book';

  const reload = () => {
    Promise.all([getWorldConfig(name), listWorldDocs(name)])
      .then(([c, d]) => { setConfig(c); setRows(d); })
      .catch((e) => setError(String(e)));
  };
  useEffect(() => {
    setError(null); setEditing(null); setTab('docs');
    Promise.all([getWorldConfig(name), listWorldDocs(name)])
      .then(([c, d]) => { setConfig(c); setRows(d); })
      .catch((e) => setError(String(e)));
  }, [name]);

  if (error) return <div style={{ color: 'var(--alert)', fontSize: 13 }}>{error}</div>;
  if (!config) return <div style={{ color: 'var(--faint)', fontSize: 13 }}>Loading…</div>;

  if (editing) {
    return (
      <WorldDocEditor
        world={name}
        config={config}
        docId={editing}
        readOnly={readOnly}
        onDone={(changed) => { setEditing(null); if (changed) reload(); }}
      />
    );
  }

  const { cls: srcCls, label: srcLabel } = sourceBadge(scope, 'workspace');
  const groups = groupDocs(rows, config, q);

  return (
    <>
      <div className={asset.edhead}>
        <div>
          <h2>{config.label ?? name}</h2>
          <div className={asset.meta}>
            <span className={`${asset.src} ${asset[srcCls]}`}>{srcLabel}</span>
            · World · {rows.length} document{rows.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className={asset.acts}>
          <button className={w.tab + (tab === 'docs' ? ' ' + w.on : '')} onClick={() => setTab('docs')}>Documents</button>
          <button className={w.tab + (tab === 'config' ? ' ' + w.on : '')} onClick={() => setTab('config')}>Config</button>
        </div>
      </div>

      {tab === 'docs' && (
        <>
          <div className={w.docbar}>
            <input className={asset.gsearch} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search documents…" />
            {!readOnly && (
              <button className={asset.addnew} title="New document" onClick={() => setEditing('new')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              </button>
            )}
          </div>
          {groups.length === 0 && <p style={{ color: 'var(--faint)', fontSize: 13 }}>No documents{q ? ' match.' : ' yet.'}</p>}
          {groups.map((g) => (
            <div key={g.type.id} className={w.typegroup}>
              <div className={w.typehead}>{g.type.label}<span className={asset.gcount}>{g.count}</span></div>
              {g.domains.map((b) => (
                <div key={b.domain} className={w.domainblock}>
                  <div className={w.domainlbl}>{b.domain === '_other' ? 'Other' : b.domain}</div>
                  {b.rows.map((r) => (
                    <div key={r.docId} className={w.docrow} onClick={() => setEditing(r.docId)}>
                      <div className={w.doctitle}>
                        {r.title}
                        {r.needsAttention && <span className={w.attn} title="Frontmatter needs attention">needs attention</span>}
                      </div>
                      <div className={w.docbadges}>
                        <span className={w.classchip}>{r.classification}</span>
                        <span className={`${w.clr} ${clrClass(r.clearance, config.clearanceLevels)}`}>{r.clearance}</span>
                        {r.appendixEligible && <span className={w.apx}>appendix</span>}
                      </div>
                      {r.summary && <div className={w.docsum}>{r.summary}</div>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      {tab === 'config' && <ConfigForm name={name} config={config} scope={scope} readOnly={readOnly} onSaved={reload} />}
    </>
  );
}

/** world.json config form. Library scope = editable; book scope = read-only snapshot. */
function ConfigForm({ name, config, scope, readOnly, onSaved }: { name: string; config: LibraryWorld; scope: Scope; readOnly: boolean; onSaved: () => void }) {
  const [label, setLabel] = useState(config.label ?? '');
  const [description, setDescription] = useState(config.description ?? '');
  const [formatDirective, setFormatDirective] = useState(config.formatDirective ?? '');
  const [classificationScheme, setClassificationScheme] = useState(config.classificationScheme ?? '');
  const [authoringEditor, setAuthoringEditor] = useState(config.authoringEditor ?? '');
  const [stripCodes, setStripCodes] = useState(config.stripCodesInAppendix ?? true);
  const [docTypes, setDocTypes] = useState<WorldDocumentType[]>(config.documentTypes ?? []);
  const [domains, setDomains] = useState<string[]>(config.domains ?? []);
  const [clearances, setClearances] = useState<string[]>(config.clearanceLevels ?? []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const mark = () => { setDirty(true); setMsg(null); };

  async function save() {
    if (saving) return;
    setSaving(true); setMsg(null);
    try {
      const next: LibraryWorld = {
        ...config,
        schemaVersion: config.schemaVersion ?? 1,
        name: config.name ?? name,
        label: label.trim() || undefined,
        description: description.trim() || undefined,
        documentTypes: docTypes,
        domains,
        clearanceLevels: clearances,
        classificationScheme: classificationScheme.trim(),
        formatDirective,
        authoringEditor: authoringEditor.trim() || undefined,
        stripCodesInAppendix: stripCodes,
      };
      await writeEntry(scope, 'world', name, { content: JSON.stringify(next, null, 2) });
      setDirty(false); setMsg('Saved');
      setTimeout(() => setMsg(null), 2000);
      onSaved();
    } catch (e) {
      setMsg(`Error: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: '70ch' }}>
      {!readOnly && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button
            onClick={save}
            disabled={!dirty || saving}
            style={{ cursor: dirty && !saving ? 'pointer' : 'not-allowed', fontFamily: 'Hanken Grotesk', fontWeight: 600, fontSize: 13, color: '#1a0f08', background: dirty && !saving ? 'linear-gradient(180deg,#f7b15a,#ec8a34)' : 'var(--panel-2)', border: '1px solid var(--line-2)', borderRadius: 10, padding: '9px 15px', opacity: dirty && !saving ? 1 : 0.5 }}
          >
            {saving ? 'Saving…' : msg ?? 'Save'}
          </button>
        </div>
      )}

      <div className={asset.descfield}>
        <div className={asset.fl}>Label</div>
        <input style={inputStyle} value={label} disabled={readOnly} onChange={(e) => { setLabel(e.target.value); mark(); }} />
      </div>
      <div className={asset.descfield}>
        <div className={asset.fl}>Description</div>
        <textarea className={asset.descbox} rows={2} value={description} disabled={readOnly} onChange={(e) => { setDescription(e.target.value); mark(); }} />
      </div>
      <div className={asset.descfield}>
        <div className={asset.fl}>Classification scheme <em>· e.g. {'{TYPE}-{DOMAIN}-{NNNN}'}</em></div>
        <input style={inputStyle} value={classificationScheme} disabled={readOnly} onChange={(e) => { setClassificationScheme(e.target.value); mark(); }} />
      </div>
      <div className={asset.descfield}>
        <div className={asset.fl}>Authoring editor <em>· optional library editor name</em></div>
        <input style={inputStyle} value={authoringEditor} disabled={readOnly} onChange={(e) => { setAuthoringEditor(e.target.value); mark(); }} placeholder="— none —" />
      </div>

      <div className={asset.descfield}>
        <div className={asset.fl}>Document types</div>
        {docTypes.map((t, i) => (
          <div key={t.id} className={w.typerow}>
            <input style={{ ...inputStyle, flex: 1 }} value={t.id} disabled={readOnly} placeholder="id" onChange={(e) => { const n = [...docTypes]; n[i] = { ...n[i], id: e.target.value }; setDocTypes(n); mark(); }} />
            <input style={{ ...inputStyle, flex: 1 }} value={t.label} disabled={readOnly} placeholder="label" onChange={(e) => { const n = [...docTypes]; n[i] = { ...n[i], label: e.target.value }; setDocTypes(n); mark(); }} />
            <input style={{ ...inputStyle, flex: 1 }} value={t.note ?? ''} disabled={readOnly} placeholder="note" onChange={(e) => { const n = [...docTypes]; n[i] = { ...n[i], note: e.target.value || undefined }; setDocTypes(n); mark(); }} />
            {!readOnly && <button className={w.tab} onClick={() => { setDocTypes(docTypes.filter((_, j) => j !== i)); mark(); }}>×</button>}
          </div>
        ))}
        {!readOnly && <button className={w.tab} onClick={() => { setDocTypes([...docTypes, { id: '', label: '' }]); mark(); }}>+ type</button>}
      </div>

      <div className={asset.descfield}>
        <div className={asset.fl}>Domains</div>
        <ChipList values={domains} readOnly={readOnly} onChange={(v) => { setDomains(v); mark(); }} placeholder="add domain…" />
      </div>
      <div className={asset.descfield}>
        <div className={asset.fl}>Clearance levels <em>· ordered open → restricted</em></div>
        <ChipList values={clearances} readOnly={readOnly} onChange={(v) => { setClearances(v); mark(); }} placeholder="add clearance…" />
      </div>

      <div className={asset.descfield}>
        <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 13, color: 'var(--text)' }}>
          <input type="checkbox" checked={stripCodes} disabled={readOnly} onChange={(e) => { setStripCodes(e.target.checked); mark(); }} />
          Strip classification codes in rendered appendix
        </label>
      </div>

      <div className={asset.descfield}>
        <div className={asset.fl}>Format directive <em>· narrative-only authoring directive</em></div>
        <textarea
          value={formatDirective}
          disabled={readOnly}
          onChange={(e) => { setFormatDirective(e.target.value); mark(); }}
          rows={8}
          spellCheck={false}
          style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 10, padding: '14px 15px', color: 'var(--text)', fontSize: 13, fontFamily: 'Fraunces, serif', lineHeight: 1.6, resize: 'vertical' }}
        />
      </div>
    </div>
  );
}

/** Simple add/remove chip list editor over a string[]. */
function ChipList({ values, onChange, readOnly, placeholder }: { values: string[]; onChange: (v: string[]) => void; readOnly: boolean; placeholder: string }) {
  const [draft, setDraft] = useState('');
  return (
    <div>
      <div className={w.chiplist}>
        {values.map((v, i) => (
          <span key={v} className={w.chip}>
            {v}
            {!readOnly && <button onClick={() => onChange(values.filter((_, j) => j !== i))}>×</button>}
          </span>
        ))}
      </div>
      {!readOnly && (
        <input
          style={inputStyle}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) { e.preventDefault(); onChange([...values, draft.trim()]); setDraft(''); }
          }}
        />
      )}
    </div>
  );
}
