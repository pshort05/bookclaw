import { useEffect, useRef, useState } from 'react';
import { api } from '@bookclaw/shared';
import type { LibraryKind, LibraryPipeline, LibraryPipelineStep } from '@bookclaw/shared';
import type { Scope } from '../../lib/assetApi.js';
import { readEntry, writeEntry } from '../../lib/assetApi.js';
import { sourceBadge } from '../../lib/sourceBadge.js';
import { ModelPicker, type ModelValue } from './ModelPicker.js';
import styles from '../../routes/AssetStudio.module.css';

interface Props {
  scope: Scope;
  kind: LibraryKind;
  name: string;
  displayName?: string;
}

// A per-chapter expansion group: at generation time its sub-steps repeat once
// per chapter, with {{n}}/{{chapterNumber}} interpolated. Authored as data here.
interface ExpandGroup {
  expand: 'chapters';
  steps: LibraryPipelineStep[];
}
type EditorStep = LibraryPipelineStep | ExpandGroup;
const isExpand = (s: EditorStep): s is ExpandGroup =>
  !!s && (s as ExpandGroup).expand === 'chapters' && Array.isArray((s as ExpandGroup).steps);

const BLANK_STEP = (): LibraryPipelineStep => ({
  label: 'New step', taskType: 'creative_writing', promptTemplate: '', skill: undefined,
});

const inputStyle = { width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'Hanken Grotesk' } as const;

// The editable field set for one step — shared by top-level steps and the
// sub-steps inside an expand group. `chapter` adds the per-chapter number field.
function StepFields({ step, skills, chapter, onPatch }: {
  step: LibraryPipelineStep;
  skills: string[];
  chapter?: boolean;
  onPatch: (patch: Partial<LibraryPipelineStep>) => void;
}) {
  return (
    <>
      <div className={styles.field}>
        <div className={styles.fl}>Label</div>
        <input type="text" value={step.label} onChange={(e) => onPatch({ label: e.target.value })} style={inputStyle} />
      </div>
      <div className={styles.field}>
        <div className={styles.fl}>Task type</div>
        <input type="text" value={step.taskType} onChange={(e) => onPatch({ taskType: e.target.value })} style={inputStyle} />
      </div>
      <div className={styles.field}>
        <div className={styles.fl}>Model <span style={{ opacity: 0.6, fontWeight: 400 }}>(optional — overrides task routing)</span></div>
        <ModelPicker
          value={(step.modelOverride ?? {}) as ModelValue}
          onChange={(v) => onPatch({ modelOverride: (v.provider || v.model || v.temperature !== undefined) ? v : undefined })}
        />
        {step.skill && (
          <div style={{ opacity: 0.6, fontSize: 12, marginTop: 4 }}>
            If this skill is an executable (multi-step) skill, it runs its own per-phase models and this override is ignored.
          </div>
        )}
      </div>
      <div className={styles.field}>
        <div className={styles.fl}>Phase</div>
        <input type="text" value={step.phase ?? ''} onChange={(e) => onPatch({ phase: e.target.value || undefined })} style={inputStyle} />
      </div>
      <div className={styles.field}>
        <div className={styles.fl}>Skill</div>
        <select
          value={step.skill ?? ''}
          onChange={(e) => onPatch({ skill: e.target.value || undefined })}
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
          onChange={(e) => onPatch({ promptTemplate: e.target.value })}
          rows={5}
          style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 10, padding: '14px 15px', color: 'var(--text)', fontSize: 13, fontFamily: 'Fraunces, serif', lineHeight: 1.6, resize: 'vertical' }}
        />
      </div>
      <div className={styles.field}>
        <div className={styles.fl}>Words / chapter target</div>
        <input
          type="text"
          value={step.wordCountTarget ?? ''}
          onChange={(e) => onPatch({ wordCountTarget: e.target.value === '' ? undefined : (Number(e.target.value) || e.target.value) as never })}
          style={{ width: 200, background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'Hanken Grotesk' }}
        />
      </div>
      {chapter && (
        <div className={styles.field}>
          <div className={styles.fl}>Chapter number <em>· use {'{{n}}'} to repeat per chapter</em></div>
          <input
            type="text"
            value={(step.chapterNumber as unknown as string) ?? ''}
            onChange={(e) => onPatch({ chapterNumber: e.target.value === '' ? undefined : (Number(e.target.value) || e.target.value) as never })}
            style={{ width: 200, background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 9, padding: '9px 12px', color: 'var(--text)', fontSize: 13, fontFamily: 'Hanken Grotesk' }}
          />
        </div>
      )}
    </>
  );
}

export function PipelineEditor({ scope, kind, name, displayName }: Props) {
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
    const steps = (pipeline.steps as EditorStep[]).map((s, idx) => idx === i ? { ...s, ...patch } : s);
    setPipeline({ ...pipeline, steps: steps as LibraryPipelineStep[] });
    mark();
  }

  // Patch / add / remove a sub-step inside a top-level expand group at index `gi`.
  function setSubStep(gi: number, si: number, patch: Partial<LibraryPipelineStep>) {
    if (!pipeline) return;
    const steps = (pipeline.steps as EditorStep[]).map((s, idx) => {
      if (idx !== gi || !isExpand(s)) return s;
      return { ...s, steps: s.steps.map((sub, j) => j === si ? { ...sub, ...patch } : sub) };
    });
    setPipeline({ ...pipeline, steps: steps as LibraryPipelineStep[] });
    mark();
  }

  function addSubStep(gi: number) {
    if (!pipeline) return;
    const steps = (pipeline.steps as EditorStep[]).map((s, idx) =>
      idx === gi && isExpand(s) ? { ...s, steps: [...s.steps, BLANK_STEP()] } : s);
    setPipeline({ ...pipeline, steps: steps as LibraryPipelineStep[] });
    mark();
  }

  function removeSubStep(gi: number, si: number) {
    if (!pipeline) return;
    const steps = (pipeline.steps as EditorStep[]).map((s, idx) =>
      idx === gi && isExpand(s) ? { ...s, steps: s.steps.filter((_, j) => j !== si) } : s);
    setPipeline({ ...pipeline, steps: steps as LibraryPipelineStep[] });
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
          <h2>{displayName ?? name}</h2>
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

          {(pipeline.steps as EditorStep[]).map((entry, i) => {
            const isOpen = openSteps.has(i);
            const moveBtns = (
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
            );

            if (isExpand(entry)) {
              return (
                <div key={stepIds[i] ?? i} className={`${styles.step}${isOpen ? ' ' + styles.open : ''}`}>
                  <div className={styles.srow} onClick={() => toggleStep(i)}>
                    <span className={styles.snum}>{i + 1}</span>
                    <span className={styles.sname}>Repeat per chapter</span>
                    <span className={styles.sctrl}>
                      <span className={styles.pill}>expand · chapters</span>
                      <span className={`${styles.pill} ${styles.wc}`}>{entry.steps.length} sub-step{entry.steps.length === 1 ? '' : 's'}</span>
                    </span>
                    <svg className={styles.chev} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </div>
                  {isOpen && (
                    <div className={styles.sbody} style={{ borderLeft: '2px solid var(--line-2)', paddingLeft: 14 }}>
                      <p style={{ color: 'var(--faint)', fontSize: 12, margin: '0 0 14px' }}>
                        These sub-steps run once per chapter at generation time. Use <code>{'{{n}}'}</code> for the chapter number and <code>{'{{wordsPerChapter}}'}</code>, <code>{'{{title}}'}</code> in templates.
                      </p>
                      {entry.steps.map((sub, si) => (
                        <div key={si} className={styles.step} style={{ marginBottom: 12 }}>
                          <div className={styles.sbody}>
                            <StepFields step={sub} skills={skills} chapter onPatch={(p) => setSubStep(i, si, p)} />
                            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                              <button
                                onClick={() => removeSubStep(i, si)}
                                title="Remove sub-step"
                                style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--alert)', cursor: 'pointer', marginLeft: 'auto' }}
                              >Remove sub-step</button>
                            </div>
                          </div>
                        </div>
                      ))}
                      <button className={styles.addstep} onClick={() => addSubStep(i)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                        Add a sub-step
                      </button>
                      {moveBtns}
                    </div>
                  )}
                </div>
              );
            }

            const step = entry;
            return (
              <div key={stepIds[i] ?? i} className={`${styles.step}${isOpen ? ' ' + styles.open : ''}`}>
                <div className={styles.srow} onClick={() => toggleStep(i)}>
                  <span className={styles.snum}>{i + 1}</span>
                  <span className={styles.sname}>{step.label}</span>
                  <span className={styles.sctrl}>
                    {step.taskType && <span className={styles.pill}>{step.taskType}</span>}
                    {step.skill && <span className={`${styles.pill} ${styles.skill}`}>{step.skill}</span>}
                    {step.wordCountTarget && <span className={`${styles.pill} ${styles.wc}`}>{String(step.wordCountTarget)} w</span>}
                  </span>
                  <svg className={styles.chev} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                {isOpen && (
                  <div className={styles.sbody}>
                    <StepFields step={step} skills={skills} onPatch={(p) => setStep(i, p)} />
                    {moveBtns}
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
