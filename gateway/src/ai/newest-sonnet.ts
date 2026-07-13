/**
 * "Newest Sonnet" resolution.
 *
 * OpenRouter has no unversioned Anthropic-Sonnet alias — only versioned slugs
 * (`anthropic/claude-sonnet-{4,4.5,4.6,5}`, plus older `claude-3.5-sonnet`). Pinning
 * one goes stale as new Sonnets ship, so the pipeline default is the sentinel
 * NEWEST_SONNET_SENTINEL, resolved at call time to the highest Sonnet in the live
 * (cached) OpenRouter catalog. `pickNewestSonnet` is the pure selection step.
 */

/** Default model value that resolves to the newest Sonnet at completion time. */
export const NEWEST_SONNET_SENTINEL = 'auto:newest-sonnet';

/** Conservative fallback when the catalog can't be reached (fail-soft). */
export const SONNET_FLOOR = 'anthropic/claude-sonnet-4.5';

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
