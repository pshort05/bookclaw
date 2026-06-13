import { useEffect, useRef, useState } from 'react';
import { api } from '@bookclaw/shared';
import type { LibraryKind, LibraryPipeline, LibraryPipelineStep } from '@bookclaw/shared';
import type { Scope } from '../../lib/assetApi.js';
import { readEntry, writeEntry } from '../../lib/assetApi.js';
import { sourceBadge } from '../../lib/sourceBadge.js';
import styles from '../../routes/AssetStudio.module.css';

// NOTE: per-step model/tier override dropdowns from the concept are deferred —
// model routing is automatic by taskType→tier; per-step model override is a separate feature.

interface Props {
  scope: Scope;
  kind: LibraryKind;
  name: string;
}

const BLANK_STEP = (): LibraryPipelineStep => ({
  label: 'New step', taskType: 'creative_writing', promptTemplate: '', skill: undefined,
});

export function PipelineEditor({ scope, kind, name }: Props) {
  const [pipeline, setPipeline] = useState<LibraryPipeline | null>(null);
  const [description, setDescription] = useState('');
  const [openSteps, setOpenSteps] = useState<Set<number>>(new Set());
  // Stable per-step React keys, parallel to pipeline.steps and remapped on every
  // structural edit — array index alone mis-associates focus/open-state on reorder.
  const [stepIds, setStepIds] = useState<string[]>([]);
  const nextId = useRef(0);
  const mkId = () => `step-${nextId.current++}`;
  const [skills, setSkills] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');

  useEffect(() => {
    setError(null); setDirty(false); setSaveMsg(null);
    readEntry(scope, kind, name)
      .then((entry) => {
        let pl: LibraryPipeline | null = null;
        if (entry.pipeline) {
          pl = entry.pipeline;
        } else if (typeof entry.content === 'string' && entry.content.trim()) {
          try { pl = JSON.parse(entry.content); } catch { /* handled below */ }
        }
        if (!pl) {
          setError('Could not load this pipeline (invalid or empty JSON).');
          return;
        }
        setPipeline(pl);
        setStepIds(pl.steps.map(() => mkId()));
        setDescription(entry.description ?? pl?.description ?? '');
        setSource(entry.source ?? '');
      })
      .catch((e) => setError(String(e)));
    // Fetch skill names for the skill selector.
    api<{ entries: Array<{ name: string }> }>('/api/library/skill')
      .then((r) => setSkills((r.entries ?? []).map((e) => e.name)))
      .catch(() => {});
  }, [scope, kind, name]);

  function mark() { setDirty(true); setSaveMsg(null); }

  function setStep(i: number, patch: Partial<LibraryPipelineStep>) {
    if (!pipeline) return;
    const steps = pipeline.steps.map((s, idx) => idx === i ? { ...s, ...patch } : s);
    setPipeline({ ...pipeline, steps });
    mark();
  }

  function addStep() {
    if (!pipeline) return;
    setPipeline({ ...pipeline, steps: [...pipeline.steps, BLANK_STEP()] });
    setStepIds((prev) => [...prev, mkId()]);
    mark();
  }

  function removeStep(i: number) {
    if (!pipeline) return;
    setPipeline({ ...pipeline, steps: pipeline.steps.filter((_, idx) => idx !== i) });
    setStepIds((prev) => prev.filter((_, idx) => idx !== i));
    setOpenSteps((prev) => { const n = new Set<number>(); prev.forEach((v) => { if (v < i) n.add(v); else if (v > i) n.add(v - 1); }); return n; });
    mark();
  }

  function moveStep(i: number, dir: -1 | 1) {
    if (!pipeline) return;
    const j = i + dir;
    if (j < 0 || j >= pipeline.steps.length) return;
    const steps = [...pipeline.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setPipeline({ ...pipeline, steps });
    setStepIds((prev) => { const n = [...prev]; [n[i], n[j]] = [n[j], n[i]]; return n; });
    setOpenSteps((prev) => {
      const n = new Set<number>();
      prev.forEach((v) => {
        if (v === i) n.add(j);
        else if (v === j) n.add(i);
        else n.add(v);
      });
      return n;
    });
    mark();
  }

  function toggleStep(i: number) {
    setOpenSteps((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i); else n.add(i);
      return n;
    });
  }

  async function handleSave() {
    if (!dirty || saving || !pipeline) return;
    setSaving(true); setSaveMsg(null);
    try {
      const serialized = JSON.stringify({ ...pipeline, description }, null, 2);
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
  if (!pipeline) return <div style={{ color: 'var(--faint)', fontSize: 13 }}>Loading…</div>;

  const isDynamic = !!pipeline.dynamic;
  const { cls: srcBadgeCls, label: srcLabel } = sourceBadge(scope, source);
  const srcBadgeClass = styles[srcBadgeCls];

  return (
    <>
      <div className={styles.edhead}>
        <div>
          <h2>{name}</h2>
          <div className={styles.meta}>
            <span className={`${styles.src} ${srcBadgeClass}`}>{srcLabel}</span>
            · Pipeline · {pipeline.steps.length} steps
            {isDynamic && <span style={{ color: 'var(--faint)', fontStyle: 'italic' }}> · generated at create-time</span>}
          </div>
        </div>
        {!isDynamic && (
          <div className={styles.acts}>
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              style={{ display:'inline-flex',alignItems:'center',gap:8,cursor:dirty&&!saving?'pointer':'not-allowed',fontFamily:'Hanken Grotesk',fontWeight:600,fontSize:13,color:'#1a0f08',background:dirty&&!saving?'linear-gradient(180deg,#f7b15a,#ec8a34)':'var(--panel-2)',border:'1px solid var(--line-2)',borderRadius:10,padding:'9px 15px',opacity:dirty&&!saving?1:0.5 }}
            >
              {saving ? 'Saving…' : saveMsg ?? 'Save'}
            </button>
          </div>
        )}
      </div>

      {/* Description */}
      <div className={styles.descfield}>
        <div className={styles.fl}>
          Description <em>· shown wherever this pipeline is listed</em>
        </div>
        <textarea
          className={styles.descbox}
          value={description}
          onChange={(e) => { setDescription(e.target.value); mark(); }}
          disabled={isDynamic}
          rows={2}
          spellCheck={false}
        />
      </div>

      {isDynamic ? (
        <p style={{ color: 'var(--faint)', fontSize: 13, fontStyle: 'italic', borderLeft: '2px solid var(--line-2)', paddingLeft: 14 }}>
          This pipeline is generated at create-time — its steps are dynamic and cannot be edited here.
        </p>
      ) : (
        <div>
          <p style={{ color: 'var(--dim)', fontSize: 13, margin: '0 0 22px', maxWidth: '64ch' }}>
            An ordered set of steps that turn an idea into a finished book. Edit any step's prompt, swap the task type or skill, add or remove steps — no code.
          </p>
          <div className={styles.steplbl}>
            Steps <span className={styles.hr} />
            {pipeline.steps.length}
          </div>

          {pipeline.steps.map((step, i) => {
            const isOpen = openSteps.has(i);
            return (
              <div key={stepIds[i] ?? i} className={`${styles.step}${isOpen ? ' ' + styles.open : ''}`}>
                <div className={styles.srow} onClick={() => toggleStep(i)}>
                  <span className={styles.snum}>{i + 1}</span>
                  <span className={styles.sname}>{step.label}</span>
                  <span className={styles.sctrl}>
                    {step.taskType && <span className={styles.pill}>{step.taskType}</span>}
                    {step.skill && <span className={`${styles.pill} ${styles.skill}`}>{step.skill}</span>}
                    {step.wordCountTarget && <span className={`${styles.pill} ${styles.wc}`}>{step.wordCountTarget.toLocaleString()} w</span>}
                  </span>
                  <svg className={styles.chev} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                {isOpen && (
                  <div className={styles.sbody}>
                    <div className={styles.field}>
                      <div className={styles.fl}>Label</div>
                      <input
                        type="text"
                        value={step.label}
                        onChange={(e) => setStep(i, { label: e.target.value })}
                        style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'Hanken Grotesk' }}
                      />
                    </div>
                    <div className={styles.field}>
                      <div className={styles.fl}>Task type</div>
                      <input
                        type="text"
                        value={step.taskType}
                        onChange={(e) => setStep(i, { taskType: e.target.value })}
                        style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'Hanken Grotesk' }}
                      />
                    </div>
                    <div className={styles.field}>
                      <div className={styles.fl}>Skill</div>
                      <select
                        value={step.skill ?? ''}
                        onChange={(e) => setStep(i, { skill: e.target.value || undefined })}
                        style={{ width: '100%', background: 'var(--panel)', border: '1px solid var(--line-2)', borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'Hanken Grotesk' }}
                      >
                        <option value="">— none —</option>
                        {skills.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className={styles.field}>
                      <div className={styles.fl}>Prompt template</div>
                      <textarea
                        value={step.promptTemplate}
                        onChange={(e) => setStep(i, { promptTemplate: e.target.value })}
                        rows={5}
                        style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 10, padding: '14px 15px', color: 'var(--text)', fontSize: 13, fontFamily: 'Fraunces, serif', lineHeight: 1.6, resize: 'vertical' }}
                      />
                    </div>
                    <div className={styles.field}>
                      <div className={styles.fl}>Words / chapter target</div>
                      <input
                        type="number"
                        value={step.wordCountTarget ?? ''}
                        onChange={(e) => setStep(i, { wordCountTarget: e.target.value ? Number(e.target.value) : undefined })}
                        min={0}
                        style={{ width: 140, background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'Hanken Grotesk' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                      <button
                        onClick={() => moveStep(i, -1)}
                        disabled={i === 0}
                        title="Move up"
                        style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--dim)', cursor: i === 0 ? 'not-allowed' : 'pointer', opacity: i === 0 ? 0.4 : 1 }}
                      >↑</button>
                      <button
                        onClick={() => moveStep(i, 1)}
                        disabled={i === pipeline.steps.length - 1}
                        title="Move down"
                        style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--dim)', cursor: i === pipeline.steps.length - 1 ? 'not-allowed' : 'pointer', opacity: i === pipeline.steps.length - 1 ? 0.4 : 1 }}
                      >↓</button>
                      <button
                        onClick={() => removeStep(i)}
                        title="Remove step"
                        style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--alert)', cursor: 'pointer', marginLeft: 'auto' }}
                      >Remove</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <button className={styles.addstep} onClick={addStep}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Add a step
          </button>
        </div>
      )}
    </>
  );
}
