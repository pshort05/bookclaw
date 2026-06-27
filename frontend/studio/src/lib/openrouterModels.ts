import { useEffect, useState } from 'react';
import { api } from '@bookclaw/shared';

export interface ModelEntry { id: string; name: string }

// Providers with a live catalog proxy (gateway-cached); any other provider has no
// datalist and degrades to plain free-text. Imported by the pickers for the gate.
export const CATALOG_PROVIDERS = new Set(['openrouter', 'claude', 'gemini']);

// Module-level singleton, keyed per provider: the catalog for a given provider is
// identical for every picker, so share one in-flight/resolved fetch across all
// instances (a pipeline/skill editor renders one picker per step/phase — without
// this, each would refetch the full catalog).
const catalogPromises = new Map<string, Promise<ModelEntry[]>>();
function loadCatalog(provider: string): Promise<ModelEntry[]> {
  let p = catalogPromises.get(provider);
  if (!p) {
    p = api<{ models: ModelEntry[] }>(`/api/models/${provider}`)
      .then((r) => {
        const models = r.models ?? [];
        // An empty list means the gateway served its no-key/degraded fail-soft body;
        // don't pin it for the session — drop the cache so a later picker retries.
        if (!models.length) catalogPromises.delete(provider);
        return models;
      })
      .catch(() => { catalogPromises.delete(provider); return []; }); // reset so a later picker can retry
    catalogPromises.set(provider, p);
  }
  return p;
}

/**
 * Lazy-load the model catalog the first time the provider is one with a catalog
 * proxy (openrouter/claude/gemini; the gateway proxies + caches each). Fail-soft:
 * on any error the list stays empty so the exact-model field degrades to plain
 * free-text. Shared by the Prompt Runner, Consistency, and per-step (pipeline/skill)
 * model pickers.
 */
export function useModelCatalog(provider: string): ModelEntry[] {
  const [models, setModels] = useState<ModelEntry[]>([]);
  useEffect(() => {
    // Clear immediately on every provider change so a switch between two catalog
    // providers (claude->gemini) never shows the previous provider's stale ids
    // while the new fetch is in flight.
    setModels([]);
    if (!CATALOG_PROVIDERS.has(provider)) return;
    let alive = true;
    loadCatalog(provider).then((m) => { if (alive) setModels(m); });
    return () => { alive = false; };
  }, [provider]);
  return models;
}
