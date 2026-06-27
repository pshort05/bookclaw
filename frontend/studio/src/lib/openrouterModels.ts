import { useEffect, useState } from 'react';
import { api } from '@bookclaw/shared';

export interface OpenRouterModel { id: string; name: string }

/**
 * Lazy-load the OpenRouter catalog the first time the provider is 'openrouter'
 * (the gateway proxies + caches it for 24h). Fail-soft: on any error the list
 * stays empty so the exact-model field degrades to plain free-text. Shared by
 * the Prompt Runner and Consistency model pickers.
 */
export function useOpenRouterModels(provider: string): OpenRouterModel[] {
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  useEffect(() => {
    if (provider !== 'openrouter' || models.length) return;
    api<{ models: OpenRouterModel[] }>('/api/models/openrouter')
      .then((r) => setModels(r.models ?? []))
      .catch(() => {});
  }, [provider, models.length]);
  return models;
}
