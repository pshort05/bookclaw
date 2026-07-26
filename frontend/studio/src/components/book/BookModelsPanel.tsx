import { useEffect, useState } from 'react';
import { api } from '@bookclaw/shared';
import { ModelPicker, type ModelValue } from '../asset/ModelPicker.js';

// Pipeline stages the author can pin a model to, keyed by the routing taskType.
// Ordered most-impactful first. NOTE: chapter drafting is NOT here — the scene-brief
// and first-draft models are role-keyed (author-seeded, editable via the two role
// rows below), because scene_brief shares taskType 'outline' and can't be targeted
// by a taskType-keyed stage pin.
const STAGES: Array<{ key: string; label: string }> = [
  { key: 'revision', label: 'Revision / polish' },
  { key: 'outline', label: 'Outline' },
  { key: 'book_bible', label: 'Book bible' },
  { key: 'consistency', label: 'Consistency' },
];

interface ModelConfig {
  default: { provider: string; model: string };
  stageModels: Record<string, { provider?: string; model?: string }>;
  sceneBriefModel?: { provider?: string; model?: string } | null;
  draftModel?: { provider?: string; model?: string } | null;
  alternateTakes?: { sceneTakes?: boolean; draftOpening?: boolean };
  temperatures?: { creative?: number; surgical?: number } | null;
  reviewCadence?: string; // '' = per_act default
}

// Human-review gate cadence options. '' is the per_act default; a saved literal
// 'per_act' is treated as '' so the two never both appear selected.
const CADENCES: Array<{ value: string; label: string }> = [
  { value: '', label: 'Per act (default)' },
  { value: 'per_chapter', label: 'After every chapter' },
  { value: 'outline_only', label: 'Outline only' },
  // outline-approval + pre-export gates are always on regardless of cadence
  // (gate-cadence.ts shouldGate), so this is "no chapter/act gates", not "none".
  { value: 'autonomous', label: 'Autonomous (outline + export only)' },
];

/**
 * Per-book model selection: the default model (all stages) plus a picker per
 * pipeline stage. Saving applies to the book manifest and the live project, so a
 * change takes effect on the NEXT step — no need to wait for the step to execute.
 */
export function BookModelsPanel({ slug }: { slug: string }) {
  const [cfg, setCfg] = useState<ModelConfig | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<ModelConfig>(`/api/books/${encodeURIComponent(slug)}/models`)
      .then((c) => { if (!cancelled) setCfg(c); })
      .catch(() => { if (!cancelled) setMsg("Couldn't load models."); });
    return () => { cancelled = true; };
  }, [slug]);

  const save = async (body: any) => {
    setMsg('Saving…');
    try {
      const r = await api<ModelConfig>(`/api/books/${encodeURIComponent(slug)}/models`, { method: 'POST', body: JSON.stringify(body) });
      setCfg(r);
      setMsg('Saved — applies on the next step.');
    } catch (e) {
      setMsg(`Couldn't save — ${String(e)}`);
    }
  };

  if (!cfg) return <div style={{ color: 'var(--faint)', fontSize: 13 }}>{msg ?? 'Loading…'}</div>;

  const row = (label: string, value: ModelValue, onChange: (v: ModelValue) => void, hint?: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '4px 0' }}>
      <span style={{ minWidth: 130, fontSize: 13, color: 'var(--dim)' }}>{label}{hint && <em style={{ color: 'var(--faint)', fontStyle: 'normal' }}> · {hint}</em>}</span>
      <ModelPicker value={value} onChange={onChange} hideTemperature />
    </div>
  );

  return (
    <div>
      {row(
        'Default',
        { provider: cfg.default.provider || undefined, model: cfg.default.model || undefined },
        (v) => save({ default: { provider: v.provider ?? '', model: v.model ?? '' } }),
        'all stages',
      )}
      {row(
        'Scene brief',
        { provider: cfg.sceneBriefModel?.provider, model: cfg.sceneBriefModel?.model },
        (v) => save({ sceneBriefModel: { provider: v.provider ?? '', model: v.model ?? '' } }),
        'author default',
      )}
      {row(
        'First draft',
        { provider: cfg.draftModel?.provider, model: cfg.draftModel?.model },
        // Also clear any legacy creative_writing stage pin so it can't shadow this.
        (v) => save({ draftModel: { provider: v.provider ?? '', model: v.model ?? '' }, stageModels: { creative_writing: { provider: '', model: '' } } }),
        'author default',
      )}
      {STAGES.map((s) =>
        row(
          s.label,
          { provider: cfg.stageModels[s.key]?.provider, model: cfg.stageModels[s.key]?.model },
          (v) => save({ stageModels: { [s.key]: { provider: v.provider ?? '', model: v.model ?? '' } } }),
        ),
      )}
      {/* Alternate Takes (Verbalized Sampling): at a creative fork, generate several
          distinct "takes" and pause for you to pick one. Per-book, per decision point.
          Applies to NEW chapters generated after saving. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', margin: '10px 0 4px' }}>
        <span style={{ minWidth: 130, fontSize: 13, color: 'var(--dim)' }}>Alternate Takes</span>
        <label style={{ fontSize: 13, color: 'var(--dim)', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!cfg.alternateTakes?.sceneTakes}
            onChange={(e) => save({ alternateTakes: { sceneTakes: e.target.checked, draftOpening: !!cfg.alternateTakes?.draftOpening } })} />
          Scene Takes
        </label>
        <label style={{ fontSize: 13, color: 'var(--dim)', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={!!cfg.alternateTakes?.draftOpening}
            onChange={(e) => save({ alternateTakes: { sceneTakes: !!cfg.alternateTakes?.sceneTakes, draftOpening: e.target.checked } })} />
          Draft Opening
        </label>
      </div>

      {/* Temperature: creative steps run warm (≥0.7), surgical steps cool (≤0.4).
          Overrides the genre defaults; a per-step pin in the write screen still wins.
          Applies to steps generated after saving. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '10px 0 4px' }}>
        <span style={{ minWidth: 130, fontSize: 13, color: 'var(--dim)' }}>Temperature <em style={{ color: 'var(--faint)', fontStyle: 'normal' }}>· creative ≥0.7 / surgical ≤0.4</em></span>
        <label style={{ fontSize: 13, color: 'var(--dim)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Creative
          <input type="number" min={0} max={2} step={0.05} style={{ width: 64 }}
            value={cfg.temperatures?.creative ?? 0.8}
            onChange={(e) => save({ temperatures: { creative: Number(e.target.value), surgical: cfg.temperatures?.surgical ?? 0.3 } })} />
        </label>
        <label style={{ fontSize: 13, color: 'var(--dim)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          Surgical
          <input type="number" min={0} max={2} step={0.05} style={{ width: 64 }}
            value={cfg.temperatures?.surgical ?? 0.3}
            onChange={(e) => save({ temperatures: { creative: cfg.temperatures?.creative ?? 0.8, surgical: Number(e.target.value) } })} />
        </label>
      </div>

      {/* Human-review gate cadence: pause the autonomous run for approval at this
          boundary. "After every chapter" gates once per chapter — the checkpoint
          for reviewing output and tuning per-step models before continuing. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '10px 0 4px' }}>
        <span style={{ minWidth: 130, fontSize: 13, color: 'var(--dim)' }}>Human-review gate</span>
        <select
          value={cfg.reviewCadence === 'per_act' ? '' : (cfg.reviewCadence ?? '')}
          onChange={(e) => save({ reviewCadence: e.target.value })}
        >
          {CADENCES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      {msg && <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 4 }}>{msg}</div>}
    </div>
  );
}
