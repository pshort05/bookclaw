import type { LibraryPrompt } from './library-types.js';

/** Validate + normalize a prompt config (from JSON content). Throws on invalid. */
export function parsePrompt(raw: unknown): LibraryPrompt {
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const systemPrompt = typeof o.systemPrompt === 'string' ? o.systemPrompt.trim() : '';
  if (!name) throw new Error('prompt.name is required');
  if (!systemPrompt) throw new Error('prompt.systemPrompt is required');
  const out: LibraryPrompt = {
    schemaVersion: typeof o.schemaVersion === 'number' ? o.schemaVersion : 1,
    name,
    systemPrompt,
  };
  if (typeof o.label === 'string') out.label = o.label;
  if (typeof o.description === 'string') out.description = o.description;
  if (typeof o.model === 'string' && o.model.trim()) out.model = o.model.trim();
  if (typeof o.temperature === 'number') out.temperature = Math.max(0, Math.min(2, o.temperature));
  return out;
}
