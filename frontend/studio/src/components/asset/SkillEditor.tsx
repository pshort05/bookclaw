import { useEffect, useState } from 'react';
import { api, Button, type LibraryKind } from '@bookclaw/shared';
import styles from './SkillEditor.module.css';

interface Props { scope: string; kind: LibraryKind; name: string; displayName?: string }
// `_id` is a client-only stable React key for the reorderable list — never sent to the server.
interface Phase { _id: string; name?: string; model: string; temperature?: number; prompt: string }
type WireStep = Omit<Phase, '_id'>;
interface SkillData {
  category: 'core' | 'author' | 'marketing' | 'premium' | 'ops' | 'toolkit';
  content: string;
  source: string;
  steps?: WireStep[];
  retries?: number;
}

const CATEGORIES = ['core', 'author', 'marketing', 'ops', 'toolkit'] as const; // premium excluded (read-only)
let phaseSeq = 0;
const newId = () => `p${phaseSeq++}`;
const blankPhase = (): Phase => ({ _id: newId(), model: '', prompt: '' });

/**
 * Skill editor (multi-step skills Phase B). Edits a skill's SKILL.md + its optional
 * executable phases (each an OpenRouter model + temperature + prompt) + retries.
 * Saves via PUT /api/skills/:name (Phase A write API). Skills were previously
 * read-only in the studio; this is the first real skill editor.
 */
export function SkillEditor({ name, displayName }: Props) {
  const [category, setCategory] = useState<SkillData['category']>('author');
  const [content, setContent] = useState('');
  const [phases, setPhases] = useState<Phase[]>([]);
  const [retries, setRetries] = useState(0);
  const [source, setSource] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    setMsg(null);
    api<{ skill: SkillData }>(`/api/skills/${encodeURIComponent(name)}`)
      .then((r) => {
        const s = r.skill;
        setCategory(CATEGORIES.includes(s.category as never) ? s.category : 'author');
        setContent(s.content ?? '');
        setPhases(Array.isArray(s.steps) ? s.steps.map((p) => ({ ...p, _id: newId() })) : []);
        setRetries(typeof s.retries === 'number' ? s.retries : 0);
        setSource(s.source ?? '');
      })
      .catch((e) => setMsg(String(e)));
  }, [name]);

  const patchPhase = (i: number, p: Partial<Phase>) => setPhases((xs) => xs.map((x, idx) => idx === i ? { ...x, ...p } : x));
  const move = (i: number, dir: -1 | 1) => setPhases((xs) => {
    const j = i + dir;
    if (j < 0 || j >= xs.length) return xs;
    const next = [...xs];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const phasesValid = phases.every((p) => p.model.trim() && p.prompt.trim());
  const contentValid = /^---\r?\n[\s\S]*?\r?\n---/.test(content) && /\bdescription\s*:/.test(content) && /\btriggers\s*:/.test(content);
  const canSave = !saving && contentValid && phasesValid;

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      // Normalize: drop empty temperatures; an empty phase list clears steps.json (passive).
      const steps = phases.map((p) => ({
        ...(p.name?.trim() ? { name: p.name.trim() } : {}),
        model: p.model.trim(),
        ...(typeof p.temperature === 'number' && !Number.isNaN(p.temperature) ? { temperature: p.temperature } : {}),
        prompt: p.prompt,
      }));
      const r = await api<{ executable: boolean }>(`/api/skills/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify({ category, content, steps, retries: Math.max(0, Math.min(4, retries)) }),
      });
      setSource('workspace');
      setMsg(r.executable ? 'Saved — executable skill.' : 'Saved.');
    } catch (e) {
      setMsg(`Couldn't save — ${String(e)}`);
    } finally { setSaving(false); }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <h2>{displayName ?? name}</h2>
        <span className={styles.src}>{source || '—'}</span>
        <Button variant="primary" onClick={save} disabled={!canSave}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
      {source && source !== 'workspace' && <p className={styles.note}>Editing a built-in skill — saving creates an editable workspace copy.</p>}
      {!contentValid && <p className={styles.warn}>SKILL.md must start with YAML frontmatter including <code>description</code> and <code>triggers</code>.</p>}
      {msg && <p className={styles.msg}>{msg}</p>}

      <label className={styles.lbl}>Category</label>
      <select className={styles.sel} value={category} onChange={(e) => setCategory(e.target.value as SkillData['category'])}>
        {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>

      <label className={styles.lbl}>SKILL.md</label>
      <textarea className={styles.content} value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />

      <div className={styles.phasesHead}>
        <label className={styles.lbl}>Executable phases <small>· OpenRouter-only; each phase is a separate billed call</small></label>
        <button className={styles.add} onClick={() => setPhases((xs) => [...xs, blankPhase()])}>+ Add phase</button>
      </div>
      {phases.length === 0 && <p className={styles.dim}>No phases — this is a passive skill (its SKILL.md is injected into the step prompt). Add a phase to make it executable.</p>}
      {phases.length > 0 && (
        <p className={styles.legend}>Templating: <code>{'{{input}}'}</code> the step text · <code>{'{{previous}}'}</code> the prior phase output · <code>{'{{guidance}}'}</code> the SKILL.md body.</p>
      )}
      {phases.map((p, i) => (
        <div key={p._id} className={styles.phase}>
          <div className={styles.phaseHead}>
            <span className={styles.pnum}>{i + 1}</span>
            <input className={styles.pname} placeholder="name (optional)" value={p.name ?? ''} onChange={(e) => patchPhase(i, { name: e.target.value })} />
            <input className={styles.pmodel} placeholder="openrouter model id (e.g. google/gemini-2.0-flash-001)" value={p.model} onChange={(e) => patchPhase(i, { model: e.target.value })} />
            <input className={styles.ptemp} type="number" step="0.1" min="0" max="2" placeholder="temp" value={p.temperature ?? ''} onChange={(e) => patchPhase(i, { temperature: e.target.value === '' ? undefined : Number(e.target.value) })} />
            <button className={styles.icon} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Up">▲</button>
            <button className={styles.icon} disabled={i === phases.length - 1} onClick={() => move(i, 1)} aria-label="Down">▼</button>
            <button className={styles.del} onClick={() => setPhases((xs) => xs.filter((_, idx) => idx !== i))}>Remove</button>
          </div>
          <textarea className={styles.pprompt} placeholder="prompt (use {{input}} / {{previous}} / {{guidance}})" value={p.prompt} onChange={(e) => patchPhase(i, { prompt: e.target.value })} spellCheck={false} />
        </div>
      ))}
      {phases.length > 0 && (
        <div className={styles.retries}>
          <label className={styles.lbl}>Retries (per failing phase)</label>
          <input type="number" min="0" max="4" step="1" value={retries} onChange={(e) => setRetries(Math.max(0, Math.min(4, Math.floor(Number(e.target.value) || 0))))} />
        </div>
      )}
    </div>
  );
}
