import { useEffect, useState } from 'react';
import { api } from '@bookclaw/shared';

export interface OpenRouterModel { id: string; name: string }

// Module-level singleton: the catalog is identical for every picker, so share one
// in-flight/resolved fetch across all instances (a pipeline/skill editor renders one
// picker per step/phase — without this, each would refetch the full catalog).
let catalogPromise: Promise<OpenRouterModel[]> | null = null;
function loadCatalog(): Promise<OpenRouterModel[]> {
  if (!catalogPromise) {
    catalogPromise = api<{ models: OpenRouterModel[] }>('/api/models/openrouter')
      .then((r) => r.models ?? [])
      .catch(() => { catalogPromise = null; return []; }); // reset so a later picker can retry
  }
  return catalogPromise;
}

/**
 * Lazy-load the OpenRouter catalog the first time the provider is 'openrouter'
 * (the gateway proxies + caches it for 24h). Fail-soft: on any error the list
 * stays empty so the exact-model field degrades to plain free-text. Shared by
 * the Prompt Runner, Consistency, and per-step (pipeline/skill) model pickers.
 */
export function useOpenRouterModels(provider: string): OpenRouterModel[] {
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  useEffect(() => {
    if (provider !== 'openrouter' || models.length) return;
    let alive = true;
    loadCatalog().then((m) => { if (alive) setModels(m); });
    return () => { alive = false; };
  }, [provider, models.length]);
  return models;
}
