/**
 * Seed builder: map character-bible entries into registry rows at book create.
 * Pure. Defaults an unspecified tier to `secondary`, drops blank names, and
 * de-dups by canonical name (first occurrence wins).
 */

import type { NameTier, RegistryCharacter } from './types.js';

export function seedRegistryCharacters(
  bibleChars: Array<{ name: string; tier?: NameTier; role?: string }>,
): RegistryCharacter[] {
  const out: RegistryCharacter[] = [];
  const seen = new Set<string>();
  for (const c of bibleChars ?? []) {
    const canonical = String(c?.name ?? '').trim();
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push({ canonical, tier: c.tier ?? 'secondary', role: String(c.role ?? '').trim(), aliases: [], driftMap: [] });
  }
  return out;
}
