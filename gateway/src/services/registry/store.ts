/**
 * Per-book name-registry.json load/save. Fail-soft read (missing/malformed →
 * empty registry, never throws), atomic write (temp + rename, mirrors book.ts).
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { NameRegistry } from './types.js';

export function registryPath(bookDir: string): string {
  return join(bookDir, 'name-registry.json');
}

export function loadRegistry(bookDir: string): NameRegistry {
  const empty: NameRegistry = { characters: [], locations: [] };
  try {
    const p = registryPath(bookDir);
    if (!existsSync(p)) return empty;
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return {
      characters: Array.isArray(j?.characters) ? j.characters : [],
      locations: Array.isArray(j?.locations) ? j.locations : [],
    };
  } catch {
    return empty;
  }
}

export function saveRegistry(bookDir: string, reg: NameRegistry): void {
  const p = registryPath(bookDir);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n');
  renameSync(tmp, p);
}
