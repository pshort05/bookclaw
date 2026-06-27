import { useId } from 'react';
import { AI_PROVIDERS, PROVIDER_DEFAULT_MODEL } from '../../lib/providers.js';
import { useOpenRouterModels } from '../../lib/openrouterModels.js';

export interface ModelValue { provider?: string; model?: string; temperature?: number }

/**
 * Shared per-step model picker: provider select (blank = auto routing) + exact
 * model (OpenRouter catalog datalist when provider is openrouter, else free text)
 * + temperature. Used by the Pipeline step editor and the Skill phase editor.
 * Mirrors the Consistency/Prompt Runner picker pattern. Fully optional value.
 */
export function ModelPicker({ value, onChange, disabled }: { value: ModelValue; onChange: (v: ModelValue) => void; disabled?: boolean }) {
  // Legacy multi-step skill phases carried a model id with no provider (they were
  // OpenRouter-only). Treat "model set, provider unset" as openrouter so the pinned
  // model stays visible and is never silently hidden or dropped.
  const provider = value.provider ?? (value.model ? 'openrouter' : '');
  const models = useOpenRouterModels(provider);
  const listId = useId();

  const emit = (patch: Partial<ModelValue>) => {
    // Base on the *derived* provider so a legacy model-only value keeps its model
    // (normalized to provider:'openrouter') instead of being wiped.
    const next: ModelValue = { ...value, provider, ...patch };
    // Normalize empties to undefined so a fully-auto step carries no override.
    if (!next.provider) { next.provider = undefined; next.model = undefined; }
    if (!next.model) next.model = undefined;
    if (next.temperature === undefined || Number.isNaN(next.temperature)) next.temperature = undefined;
    onChange(next);
  };

  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select value={provider} disabled={disabled} onChange={(e) => emit({ provider: e.target.value, model: '' })}>
        <option value="">auto (by task)</option>
        {AI_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      {provider !== '' && (
        <>
          <input
            type="text"
            list={provider === 'openrouter' ? listId : undefined}
            value={value.model ?? ''}
            placeholder={PROVIDER_DEFAULT_MODEL[provider] ?? 'model id'}
            disabled={disabled}
            onChange={(e) => emit({ model: e.target.value })}
          />
          {provider === 'openrouter' && (
            <datalist id={listId}>
              {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </datalist>
          )}
        </>
      )}
      <input
        type="number" step="0.1" min="0" max="2" placeholder="temp"
        style={{ width: 64 }}
        value={value.temperature ?? ''}
        disabled={disabled}
        onChange={(e) => emit({ temperature: e.target.value === '' ? undefined : Number(e.target.value) })}
      />
    </span>
  );
}
