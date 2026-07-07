import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@bookclaw/shared';
import type { LibraryKind, LibraryPipeline, LibraryPipelineStep } from '@bookclaw/shared';
import type { Scope } from '../../lib/assetApi.js';
import { readEntry, writeEntry } from '../../lib/assetApi.js';
import { DndContext, DragOverlay, closestCenter, useDroppable, type DragEndEvent, type DragStartEvent, type DragOverEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { SortableRow, DragHandle, useDndSensors } from './dnd/Sortable.js';
import { StepPalette } from './StepPalette.js';
import { parsePaletteId, nodeFromPalette, STEP_PRESETS, type PaletteItem } from '../../lib/stepPresets.js';
import {
  fromSteps, toSteps, reorder, insertTop, insertMember, removeByKey, patchStep,
  moveIntoGroup, extractFromGroup, containerOf, indexIn, findByKey,
  isGroupNode, type Node,
} from '../../lib/pipelineEdits.js';
import { sourceBadge } from '../../lib/sourceBadge.js';
import { ModelPicker, type ModelValue } from './ModelPicker.js';
import styles from '../../routes/AssetStudio.module.css';

interface Props {
  scope: Scope;
  kind: LibraryKind;
  name: string;
  displayName?: string;
}

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

function GroupDropZone({ groupKey }: { groupKey: string }) {
  const { isOver, setNodeRef } = useDroppable({ id: `gbody:${groupKey}` });
  return (
    <div ref={setNodeRef} className={`${styles.gdrop}${isOver ? ' ' + styles.dropon : ''}`}>
      Drop a step here
    </div>
  );
}

function FlowColumn({ children }: { children: ReactNode }) {
  const { setNodeRef } = useDroppable({ id: 'flow' });
  return <div ref={setNodeRef}>{children}</div>;
}

export function PipelineEditor({ scope, kind, name, displayName }: Props) {
  const [pipeline, setPipeline] = useState<LibraryPipeline | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [description, setDescription] = useState('');
  const [openKeys, setOpenKeys] = useState<Set<string>>(new Set());
  const nextId = useRef(0);
  const mkId = () => `step-${nextId.current++}`;
  const sensors = useDndSensors();
  const [dragLabel, setDragLabel] = useState<string | null>(null);
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
        setNodes(fromSteps(pl.steps, mkId));
        setOpenKeys(new Set());
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

  function patchNode(key: string, patch: Partial<LibraryPipelineStep>) {
    setNodes((ns) => patchStep(ns, key, patch));
    mark();
  }

  function addStep() {
    setNodes((ns) => insertTop(ns, ns.length, { key: mkId(), kind: 'step', step: BLANK_STEP() }));
    mark();
  }

  function addSubStep(groupKey: string) {
    setNodes((ns) => {
      const g = ns.find((n) => n.key === groupKey);
      const at = g && isGroupNode(g) ? g.members.length : 0;
      return insertMember(ns, groupKey, at, { key: mkId(), kind: 'step', step: BLANK_STEP() });
    });
    mark();
  }

  function removeNode(key: string) {
    setNodes((ns) => removeByKey(ns, key));
    setOpenKeys((prev) => { const n = new Set(prev); n.delete(key); return n; });
    mark();
  }

  function moveTop(i: number, dir: -1 | 1) {
    setNodes((ns) => reorder(ns, undefined, i, i + dir));
    mark();
  }

  function toggleOpen(key: string) {
    setOpenKeys((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key); else n.add(key);
      return n;
    });
  }

  function labelOf(id: string): string {
    const pal = parsePaletteId(id);
    if (pal) {
      if (pal.type === 'skill') return pal.name;
      if (pal.type === 'block') return pal.kind === 'parallel' ? 'Run in parallel' : 'Repeat per chapter';
      return STEP_PRESETS.find((p) => p.key === pal.key)?.label ?? pal.key;
    }
    const n = findByKey(nodes, id);
    if (!n) return 'Untitled step';
    return isGroupNode(n) ? (n.kind === 'parallel' ? 'Run in parallel' : 'Repeat per chapter') : (n.step.label || 'Untitled step');
  }

  function onDragStart(e: DragStartEvent) {
    setDragLabel(labelOf(String(e.active.id)));
  }

  function onDragOver(e: DragOverEvent) {
    const over = e.over;
    if (!over) return;
    const id = String(over.id);
    // Don't act on the group currently being dragged by its own handle.
    if (id === String(e.active.id)) return;
    const n = findByKey(nodes, id);
    if (n && isGroupNode(n) && !openKeys.has(id)) {
      setOpenKeys((prev) => { const next = new Set(prev); next.add(id); return next; });
    }
  }

  function appendFromPalette(item: PaletteItem) {
    const node = nodeFromPalette(item, mkId);
    if (!node) return;
    setNodes((ns) => insertTop(ns, ns.length, node));
    mark();
  }

  function onDragEnd(e: DragEndEvent) {
    setDragLabel(null);
    const { active, over } = e;
    if (!over) return;
    const a = String(active.id);
    const o = String(over.id);
    if (a === o) return;

    // --- palette drops: create a node at the drop position ---
    const pal = parsePaletteId(a);
    if (pal) {
      const node = nodeFromPalette(pal, mkId);
      if (!node) return;
      if (o === 'flow') {
        const next = insertTop(nodes, nodes.length, node);
        if (next !== nodes) { setNodes(next); mark(); }
        return;
      }
      if (o.startsWith('gbody:')) {
        if (isGroupNode(node)) return; // no groups inside groups
        const gk = o.slice(6);
        const g = nodes.find((n) => n.key === gk);
        const next = g && isGroupNode(g) ? insertMember(nodes, gk, g.members.length, node) : nodes;
        if (next !== nodes) { setNodes(next); mark(); }
        return;
      }
      const c = containerOf(nodes, o);
      if (c === null) return;
      if (c === undefined) {
        const next = insertTop(nodes, indexIn(nodes, undefined, o), node);
        if (next !== nodes) { setNodes(next); mark(); }
        return;
      }
      if (isGroupNode(node)) return;
      { const next = insertMember(nodes, c, indexIn(nodes, c, o), node); if (next !== nodes) { setNodes(next); mark(); } }
      return;
    }

    // --- moving an existing node ---
    const ca = containerOf(nodes, a);
    if (ca === null) return;
    if (o === 'flow') {
      // dropped on the column background: members extract to the end; top-level = no-op
      if (typeof ca === 'string') {
        const next = extractFromGroup(nodes, a, nodes.length);
        if (next !== nodes) { setNodes(next); mark(); }
      }
      return;
    }
    if (o.startsWith('gbody:')) {
      const gk = o.slice(6);
      if (ca === gk) return;
      const next = moveIntoGroup(nodes, a, gk); // rejects group nodes internally
      if (next !== nodes) { setNodes(next); mark(); }
      return;
    }
    const co = containerOf(nodes, o);
    if (co === null) return;
    if (ca === co) {
      const next = reorder(nodes, ca, indexIn(nodes, ca, a), indexIn(nodes, ca, o));
      if (next !== nodes) { setNodes(next); mark(); }
      return;
    }
    if (co === undefined) {
      const next = extractFromGroup(nodes, a, indexIn(nodes, undefined, o));
      if (next !== nodes) { setNodes(next); mark(); }
      return;
    }
    { const next = moveIntoGroup(nodes, a, co, indexIn(nodes, co, o)); // rejects group nodes internally
      if (next !== nodes) { setNodes(next); mark(); } }
  }

  async function handleSave() {
    if (!dirty || saving || !pipeline) return;
    setSaving(true); setSaveMsg(null);
    try {
      const serialized = JSON.stringify({ ...pipeline, steps: toSteps(nodes), description }, null, 2);
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
            · Pipeline · {nodes.length} steps
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
          <div className={styles.builder}>
            <StepPalette skills={skills} onAppend={appendFromPalette} />
            <FlowColumn>
              <p style={{ color: 'var(--dim)', fontSize: 13, margin: '0 0 22px', maxWidth: '64ch' }}>
                An ordered set of steps that turn an idea into a finished book. Drag steps from the palette, drag rows to reorder or into a group — or edit any step's prompt, task type, or skill. No code.
              </p>
              <div className={styles.steplbl}>
                Steps <span className={styles.hr} />
                {nodes.length}
              </div>
              <SortableContext items={nodes.map((n) => n.key)} strategy={verticalListSortingStrategy}>
                {nodes.map((node, i) => {
                  const isOpen = openKeys.has(node.key);
                  const moveBtns = (
                    <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                      <button
                        onClick={() => moveTop(i, -1)}
                        disabled={i === 0}
                        title="Move up"
                        style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--dim)', cursor: i === 0 ? 'not-allowed' : 'pointer', opacity: i === 0 ? 0.4 : 1 }}
                      >↑</button>
                      <button
                        onClick={() => moveTop(i, 1)}
                        disabled={i === nodes.length - 1}
                        title="Move down"
                        style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--dim)', cursor: i === nodes.length - 1 ? 'not-allowed' : 'pointer', opacity: i === nodes.length - 1 ? 0.4 : 1 }}
                      >↓</button>
                      <button
                        onClick={() => removeNode(node.key)}
                        title="Remove step"
                        style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--alert)', cursor: 'pointer', marginLeft: 'auto' }}
                      >Remove</button>
                    </div>
                  );

                  if (isGroupNode(node)) {
                    const chapter = node.kind === 'expand';
                    return (
                      <SortableRow key={node.key} id={node.key}>
                        <div className={`${styles.step}${isOpen ? ' ' + styles.open : ''}`}>
                          <div className={styles.srow} onClick={() => toggleOpen(node.key)}>
                            <DragHandle />
                            <span className={styles.snum}>{i + 1}</span>
                            <span className={styles.sname}>{chapter ? 'Repeat per chapter' : 'Run in parallel'}</span>
                            <span className={styles.sctrl}>
                              <span className={styles.pill}>{chapter ? 'expand · chapters' : 'parallel'}</span>
                              <span className={`${styles.pill} ${styles.wc}`}>{node.members.length} sub-step{node.members.length === 1 ? '' : 's'}</span>
                            </span>
                            <svg className={styles.chev} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                          {isOpen && (
                            <div className={styles.sbody} style={{ borderLeft: '2px solid var(--line-2)', paddingLeft: 14 }}>
                              <p style={{ color: 'var(--faint)', fontSize: 12, margin: '0 0 14px' }}>
                                {chapter ? (
                                  <>These sub-steps run once per chapter at generation time. Use <code>{'{{n}}'}</code> for the chapter number and <code>{'{{wordsPerChapter}}'}</code>, <code>{'{{title}}'}</code> in templates.</>
                                ) : (
                                  <>These sub-steps run concurrently at generation time; the step after this group is the implicit join and sees every member's output in its context.</>
                                )}
                              </p>
                              <SortableContext items={node.members.map((m) => m.key)} strategy={verticalListSortingStrategy}>
                                {node.members.map((sub) => {
                                  const subOpen = openKeys.has(sub.key);
                                  return (
                                    <SortableRow key={sub.key} id={sub.key}>
                                      <div className={styles.step} style={{ marginBottom: 12 }}>
                                        <div className={styles.subhead} onClick={() => toggleOpen(sub.key)} style={{ cursor: 'pointer', paddingBottom: subOpen ? 0 : 10 }}>
                                          <DragHandle />
                                          <span style={{ fontFamily: 'Fraunces, serif', fontSize: 14.5 }}>{sub.step.label || 'Untitled step'}</span>
                                          <span className={styles.sctrl}>
                                            {sub.step.taskType && <span className={styles.pill}>{sub.step.taskType}</span>}
                                            {sub.step.skill && <span className={`${styles.pill} ${styles.skill}`}>{sub.step.skill}</span>}
                                          </span>
                                        </div>
                                        {subOpen && (
                                          <div className={styles.sbody}>
                                            <StepFields step={sub.step} skills={skills} chapter={chapter} onPatch={(p) => patchNode(sub.key, p)} />
                                            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                                              <button
                                                onClick={() => removeNode(sub.key)}
                                                title="Remove sub-step"
                                                style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--alert)', cursor: 'pointer', marginLeft: 'auto' }}
                                              >Remove sub-step</button>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </SortableRow>
                                  );
                                })}
                              </SortableContext>
                              <GroupDropZone groupKey={node.key} />
                              <button className={styles.addstep} onClick={() => addSubStep(node.key)}>
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
                                Add a sub-step
                              </button>
                              {moveBtns}
                            </div>
                          )}
                        </div>
                      </SortableRow>
                    );
                  }

                  return (
                    <SortableRow key={node.key} id={node.key}>
                      <div className={`${styles.step}${isOpen ? ' ' + styles.open : ''}`}>
                        <div className={styles.srow} onClick={() => toggleOpen(node.key)}>
                          <DragHandle />
                          <span className={styles.snum}>{i + 1}</span>
                          <span className={styles.sname}>{node.step.label}</span>
                          <span className={styles.sctrl}>
                            {node.step.taskType && <span className={styles.pill}>{node.step.taskType}</span>}
                            {node.step.skill && <span className={`${styles.pill} ${styles.skill}`}>{node.step.skill}</span>}
                            {node.step.wordCountTarget && <span className={`${styles.pill} ${styles.wc}`}>{String(node.step.wordCountTarget)} w</span>}
                          </span>
                          <svg className={styles.chev} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                        {isOpen && (
                          <div className={styles.sbody}>
                            <StepFields step={node.step} skills={skills} onPatch={(p) => patchNode(node.key, p)} />
                            {moveBtns}
                          </div>
                        )}
                      </div>
                    </SortableRow>
                  );
                })}
              </SortableContext>
              <button className={styles.addstep} onClick={addStep}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
                Add a step
              </button>
            </FlowColumn>
          </div>
          <DragOverlay>
            {dragLabel !== null && (
              <div className={styles.palcard} style={{ cursor: 'grabbing', background: 'var(--panel)' }}>
                <span className={styles.grip}>⠿</span><span>{dragLabel}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </>
  );
}
