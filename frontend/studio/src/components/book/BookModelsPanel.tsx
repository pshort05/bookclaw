import { useEffect, useState } from 'react';
import { api } from '@bookclaw/shared';
import { ModelPicker, type ModelValue } from '../asset/ModelPicker.js';

// Pipeline stages the author can pin a model to, keyed by the routing taskType.
// Ordered most-impactful first (prose drafting / polish).
const STAGES: Array<{ key: string; label: string }> = [
  { key: 'creative_writing', label: 'Chapter drafting' },
  { key: 'revision', label: 'Revision / polish' },
  { key: 'outline', label: 'Outline' },
  { key: 'book_bible', label: 'Book bible' },
  { key: 'consistency', label: 'Consistency' },
];

interface ModelConfig {
  default: { provider: string; model: string };
  stageModels: Record<string, { provider?: string; model?: string }>;
}

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
      {STAGES.map((s) =>
        row(
          s.label,
          { provider: cfg.stageModels[s.key]?.provider, model: cfg.stageModels[s.key]?.model },
          (v) => save({ stageModels: { [s.key]: { provider: v.provider ?? '', model: v.model ?? '' } } }),
        ),
      )}
      {msg && <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 4 }}>{msg}</div>}
    </div>
  );
}
