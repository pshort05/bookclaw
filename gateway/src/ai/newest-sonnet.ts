/**
 * "Newest Sonnet / Haiku" resolution.
 *
 * OpenRouter has no unversioned Anthropic-Sonnet/Haiku alias — only versioned slugs
 * (`anthropic/claude-sonnet-{4,4.5,4.6,5}` / `claude-haiku-4.5`, plus older
 * `claude-3.5-sonnet` / `claude-3.5-haiku`). Pinning one goes stale as new models
 * ship, so a step can default to the sentinel NEWEST_SONNET_SENTINEL /
 * NEWEST_HAIKU_SENTINEL, resolved at call time to the highest version of that
 * family in the live (cached) OpenRouter catalog. `pickNewestSonnet` /
 * `pickNewestHaiku` are the pure selection steps.
 */

/** Default model value that resolves to the newest Sonnet at completion time. */
export const NEWEST_SONNET_SENTINEL = 'auto:newest-sonnet';

/** Default model value that resolves to the newest Haiku at completion time. */
export const NEWEST_HAIKU_SENTINEL = 'auto:newest-haiku';

/** Conservative fallback when the catalog can't be reached (fail-soft). */
export const SONNET_FLOOR = 'anthropic/claude-sonnet-4.5';

/** Conservative Haiku fallback when the catalog can't be reached (fail-soft). */
export const HAIKU_FLOOR = 'anthropic/claude-haiku-4.5';

/** Extract a comparable version from a Sonnet slug, or null if it isn't one. */
function sonnetVersion(id: string): number | null {
  const lower = id.toLowerCase();
  if (!lower.includes('sonnet') || !lower.includes('claude')) return null;
  // New naming `claude-sonnet-<ver>` (stops before any date/suffix), or the older
  // `claude-<ver>-sonnet`. Match the version token only (digits + optional decimal).
  const m = lower.match(/claude-sonnet-(\d+(?:\.\d+)?)/) || lower.match(/claude-(\d+(?:\.\d+)?)-sonnet/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Pick the newest Sonnet id from a catalog. Highest version wins; among equal
 * versions the shorter id wins (prefers the stable `...-4.5` over a dated
 * `...-4.5-20250929`). Returns null when the list has no Sonnet.
 */
export function pickNewestSonnet(ids: string[]): string | null {
  const candidates = ids
    .map((id) => ({ id, v: sonnetVersion(id) }))
    .filter((x): x is { id: string; v: number } => x.v !== null);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.v - a.v || a.id.length - b.id.length);
  return candidates[0].id;
}

/** Extract a comparable version from a Haiku slug, or null if it isn't one. */
function haikuVersion(id: string): number | null {
  const lower = id.toLowerCase();
  if (!lower.includes('haiku') || !lower.includes('claude')) return null;
  // New naming `claude-haiku-<ver>`, or the older `claude-<ver>-haiku`.
  const m = lower.match(/claude-haiku-(\d+(?:\.\d+)?)/) || lower.match(/claude-(\d+(?:\.\d+)?)-haiku/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Pick the newest Haiku id from a catalog. Highest version wins; among equal
 * versions the shorter id wins (prefers the stable `...-4.5` over a dated
 * `...-4.5-20251001`). Returns null when the list has no Haiku.
 */
export function pickNewestHaiku(ids: string[]): string | null {
  const candidates = ids
    .map((id) => ({ id, v: haikuVersion(id) }))
    .filter((x): x is { id: string; v: number } => x.v !== null);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.v - a.v || a.id.length - b.id.length);
  return candidates[0].id;
}
