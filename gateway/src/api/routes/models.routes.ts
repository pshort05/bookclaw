import { Application, Request, Response } from 'express';
import { asyncHandler } from './_shared.js';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — OpenRouter adds models ~weekly.

export interface ModelEntry { id: string; name: string }

/**
 * Map the OpenRouter /models response to a sorted {id, name} list. Pure so it
 * can be unit-tested without a network call. Drops entries with no usable id.
 */
export function parseOpenRouterModels(body: any): ModelEntry[] {
  const data = Array.isArray(body?.data) ? body.data : [];
  return data
    .filter((m: any) => typeof m?.id === 'string' && m.id)
    .map((m: any) => ({ id: m.id as string, name: typeof m?.name === 'string' && m.name ? m.name : m.id }))
    .sort((a: ModelEntry, b: ModelEntry) => a.id.localeCompare(b.id));
}

// In-memory cache for the OpenRouter catalog: re-fetched on restart and after
// the TTL. Module-level so it is shared across requests for the process life.
let cache: { at: number; models: ModelEntry[] } | null = null;

async function fetchOpenRouterModels(apiKey: string | null): Promise<ModelEntry[]> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(OPENROUTER_MODELS_URL, { headers });
  if (!res.ok) throw new Error(`OpenRouter /models returned ${res.status}`);
  return parseOpenRouterModels(await res.json());
}

/**
 * OpenRouter model catalog for the Prompt Runner exact-model picker. The /models
 * endpoint is public; we send the vault key when present for cleaner rate-limits.
 * Fail-soft: a fetch error serves any stale cache, else an empty list (never a
 * 5xx) so the studio's exact-model field degrades to plain free-text.
 */
export function mountModels(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();

  app.get('/api/models/openrouter', asyncHandler(async (_req: Request, res: Response) => {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
      return res.json({ models: cache.models, cachedAt: cache.at });
    }
    try {
      let apiKey: string | null = null;
      try { apiKey = (await services.vault?.get?.('openrouter_api_key')) ?? null; } catch { apiKey = null; }
      const models = await fetchOpenRouterModels(apiKey);
      cache = { at: Date.now(), models };
      res.json({ models, cachedAt: cache.at });
    } catch (err: any) {
      if (cache) return res.json({ models: cache.models, cachedAt: cache.at, stale: true });
      res.json({ models: [], error: String(err?.message || err) });
    }
  }));
}
