import type { LibraryEditor } from './library-types.js';

/** Validate + normalize an editor config (from JSON content). Throws on invalid. */
export function parseEditor(raw: unknown): LibraryEditor {
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const systemPrompt = typeof o.systemPrompt === 'string' ? o.systemPrompt.trim() : '';
  if (!name) throw new Error('editor.name is required');
  if (!systemPrompt) throw new Error('editor.systemPrompt is required');
  const out: LibraryEditor = {
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
