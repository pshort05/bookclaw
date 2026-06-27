import { Application, Request, Response } from 'express';
import { asyncHandler } from './_shared.js';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1000';
const GOOGLE_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const DAY_MS = 24 * 60 * 60 * 1000;
const OPENROUTER_TTL_MS = 1 * DAY_MS; // OpenRouter adds models ~weekly.
const FIRST_PARTY_TTL_MS = 7 * DAY_MS; // claude/gemini catalogs change slowly.

// Bound every upstream catalog fetch so a hung/black-holed endpoint rejects and
// serveCatalog reaches its seed/cache fallback instead of hanging the request.
const FETCH_TIMEOUT_MS = 10_000;

// Operational/offline escape hatch: skip the live catalog fetch entirely and serve
// the pre-seeded/cached list only. Used by air-gapped deploys and the smoke test so
// it never touches the network.
const MODELS_OFFLINE = process.env.BOOKCLAW_MODELS_OFFLINE === '1';

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

/**
 * Map the Anthropic /v1/models response to a sorted {id, name} list. Pure.
 * Entry shape: { type: 'model', id, display_name, created_at }.
 */
export function parseAnthropicModels(body: any): ModelEntry[] {
  const data = Array.isArray(body?.data) ? body.data : [];
  return data
    .filter((m: any) => typeof m?.id === 'string' && m.id)
    .map((m: any) => ({
      id: m.id as string,
      name: typeof m?.display_name === 'string' && m.display_name ? m.display_name : (m.id as string),
    }))
    .sort((a: ModelEntry, b: ModelEntry) => a.id.localeCompare(b.id));
}

/**
 * Map the Google Generative Language ListModels response to a sorted {id, name}
 * list. Pure. Keeps only models that support generateContent (drops embeddings /
 * vision-only endpoints) and strips the `models/` name prefix to form the id.
 */
export function parseGoogleModels(body: any): ModelEntry[] {
  const models = Array.isArray(body?.models) ? body.models : [];
  return models
    .filter(
      (m: any) =>
        typeof m?.name === 'string' &&
        Array.isArray(m?.supportedGenerationMethods) &&
        m.supportedGenerationMethods.includes('generateContent'),
    )
    .map((m: any) => {
      const id = (m.name as string).replace(/^models\//, '');
      return { id, name: typeof m?.displayName === 'string' && m.displayName ? m.displayName : id };
    })
    .filter((m: ModelEntry) => !!m.id)
    .sort((a: ModelEntry, b: ModelEntry) => a.id.localeCompare(b.id));
}

async function fetchOpenRouterModels(apiKey: string | null): Promise<ModelEntry[]> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(OPENROUTER_MODELS_URL, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OpenRouter /models returned ${res.status}`);
  return parseOpenRouterModels(await res.json());
}

async function fetchAnthropicModels(apiKey: string | null): Promise<ModelEntry[]> {
  const res = await fetch(ANTHROPIC_MODELS_URL, {
    headers: { Accept: 'application/json', 'x-api-key': apiKey as string, 'anthropic-version': '2023-06-01' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Anthropic /v1/models returned ${res.status}`);
  return parseAnthropicModels(await res.json());
}

async function fetchGoogleModels(apiKey: string | null): Promise<ModelEntry[]> {
  const res = await fetch(`${GOOGLE_MODELS_URL}?key=${encodeURIComponent(apiKey as string)}&pageSize=1000`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Google /v1beta/models returned ${res.status}`);
  return parseGoogleModels(await res.json());
}

interface Catalog {
  ttl: number;
  vaultKey: string;
  /** First-party providers can't list models without a key — fall back to the seed. */
  requireKey: boolean;
  /** Usability floor shown when no key is set or a live fetch fails. */
  seed: ModelEntry[];
  fetcher: (apiKey: string | null) => Promise<ModelEntry[]>;
}

const CATALOGS: Record<string, Catalog> = {
  openrouter: { ttl: OPENROUTER_TTL_MS, vaultKey: 'openrouter_api_key', requireKey: false, seed: [], fetcher: fetchOpenRouterModels },
  claude: {
    ttl: FIRST_PARTY_TTL_MS,
    vaultKey: 'anthropic_api_key',
    requireKey: true,
    seed: [
      { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
      { id: 'claude-opus-4-1', name: 'Claude Opus 4.1' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
    ],
    fetcher: fetchAnthropicModels,
  },
  gemini: {
    ttl: FIRST_PARTY_TTL_MS,
    vaultKey: 'gemini_api_key',
    requireKey: true,
    seed: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
    ],
    fetcher: fetchGoogleModels,
  },
};

// Per-provider in-memory cache: re-fetched on restart and after the TTL. First-party
// catalogs are pre-seeded (at: 0, never counted as fresh) so the picker is populated
// before the first successful fetch and whenever a fetch fails.
const caches = new Map<string, { at: number; models: ModelEntry[] }>();
for (const [provider, catalog] of Object.entries(CATALOGS)) {
  if (catalog.seed.length) caches.set(provider, { at: 0, models: catalog.seed });
}

// In-flight fetch per provider: concurrent cold/expired requests share one upstream
// call instead of each firing its own (multiplying vendor rate-limit pressure).
const inflight = new Map<string, Promise<ModelEntry[]>>();

function fetchCatalog(provider: string, catalog: Catalog, services: any): Promise<ModelEntry[]> {
  let p = inflight.get(provider);
  if (!p) {
    p = (async () => {
      let apiKey: string | null = null;
      try { apiKey = (await services.vault?.get?.(catalog.vaultKey)) ?? null; } catch { apiKey = null; }
      if (catalog.requireKey && !apiKey) throw new Error(`${provider} model catalog needs an API key`);
      return catalog.fetcher(apiKey);
    })().finally(() => inflight.delete(provider));
    inflight.set(provider, p);
  }
  return p;
}

async function serveCatalog(provider: string, services: any, res: Response): Promise<void> {
  const catalog = CATALOGS[provider];
  const cached = caches.get(provider);
  if (cached && cached.at > 0 && Date.now() - cached.at < catalog.ttl) {
    res.json({ models: cached.models, cachedAt: cached.at });
    return;
  }
  try {
    if (MODELS_OFFLINE) throw new Error('model catalog fetch disabled (BOOKCLAW_MODELS_OFFLINE)');
    const models = await fetchCatalog(provider, catalog, services);
    // Never let an empty/degraded 200 clobber the seed (or a prior good list): treat
    // it as a soft failure so the fallback below serves the seed instead of pinning
    // an empty list as "fresh" for the full TTL.
    if (!models.length) throw new Error(`${provider} model catalog returned no models`);
    const at = Date.now();
    caches.set(provider, { at, models });
    res.json({ models, cachedAt: at });
  } catch (err: any) {
    const fallback = caches.get(provider);
    if (fallback) {
      res.json({ models: fallback.models, cachedAt: fallback.at, stale: true });
      return;
    }
    res.json({ models: [], error: String(err?.message || err) });
  }
}

/**
 * Model catalogs for the studio exact-model pickers. OpenRouter's /models is
 * public (the vault key is sent only for cleaner rate-limits); claude/gemini
 * require a key and fall back to a small pre-seeded list. Fail-soft: a fetch
 * error serves any cache (incl. the seed) else an empty list — never a 5xx — so
 * the exact-model field degrades to plain free-text.
 */
export function mountModels(app: Application, gateway: any, _baseDir: string): void {
  const services = gateway.getServices();
  for (const provider of Object.keys(CATALOGS)) {
    app.get(`/api/models/${provider}`, asyncHandler(async (_req: Request, res: Response) => {
      await serveCatalog(provider, services, res);
    }));
  }
}
