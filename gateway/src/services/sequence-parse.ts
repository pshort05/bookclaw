import type { LibrarySequence } from './library-types.js';

/** Validate + normalize a sequence definition (from JSON content). Throws on invalid. */
export function parseSequence(raw: unknown): LibrarySequence {
  const o = (raw ?? {}) as Record<string, unknown>;
  const pipelines = o.pipelines;
  if (!Array.isArray(pipelines) || pipelines.length === 0) {
    throw new Error('sequence.pipelines must be a non-empty array');
  }
  if (!pipelines.every((p) => typeof p === 'string' && p.trim().length > 0)) {
    throw new Error('sequence.pipelines must be non-empty strings');
  }
  return {
    schemaVersion: typeof o.schemaVersion === 'number' ? o.schemaVersion : 1,
    name: String(o.name ?? ''),
    label: typeof o.label === 'string' ? o.label : undefined,
    description: typeof o.description === 'string' ? o.description : undefined,
    pipelines: pipelines.map((p) => (p as string).trim()),
  };
}
