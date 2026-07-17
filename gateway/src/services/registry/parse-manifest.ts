/**
 * parseManifest — locate the sentinel-delimited BookClaw manifest anywhere in a
 * chapter (header/footer/mid-doc, BY SENTINEL not offset), validate it, strip
 * it, and residue-check the stripped prose. Pure. Anti-bleed: a manifest must
 * NEVER survive into chapter prose — the residue check is a committed guard of
 * the same class as the Ch1 "Note on canon conflict" leak.
 */

export const SENTINEL_OPEN = '<!--BOOKCLAW:MANIFEST';
export const SENTINEL_CLOSE = '/MANIFEST-->';

export type ManifestFlag = 'new' | 'mentioned' | 'transient';
export interface ManifestCharacter { name: string; flag: ManifestFlag; role?: string; possiblySameAs?: string; }
export interface ManifestLocation { name: string; flag: ManifestFlag; role?: string; }
export type ManifestStatus = 'ok' | 'empty' | 'missing' | 'malformed' | 'residue';
export interface ParsedManifest {
  status: ManifestStatus;
  characters: ManifestCharacter[];
  locations: ManifestLocation[];
  stripped: string;
}

const FLAGS = new Set<ManifestFlag>(['new', 'mentioned', 'transient']);

/** True if any manifest marker survives in the stripped prose. Exported so the
 *  remnant sweep can assert a model's cleaned output is genuinely residue-free
 *  before trusting it (anti-bleed). */
export function hasManifestResidue(s: string): boolean {
  return s.includes(SENTINEL_OPEN) || s.includes(SENTINEL_CLOSE) || /^(CHARACTERS|LOCATIONS):/m.test(s);
}

/** Parse one `- name | flag | role | possibly-same-as: X` row; null for a "none" marker. */
function parseRow(line: string): { name: string; flag: ManifestFlag; role?: string; possiblySameAs?: string } | null {
  const body = line.replace(/^-\s*/, '').trim();
  if (!body || /^\(?none/i.test(body)) return null;
  const parts = body.split('|').map(p => p.trim()).filter(p => p.length > 0);
  const name = parts[0] ?? '';
  if (!name) return null;
  let flag: ManifestFlag = 'new';
  let role: string | undefined;
  let possiblySameAs: string | undefined;
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const psa = /^possibly-same-as:\s*(.+)$/i.exec(p);
    if (psa) { possiblySameAs = psa[1].trim(); continue; }
    if (FLAGS.has(p as ManifestFlag)) { if (i === 1) flag = p as ManifestFlag; continue; }
    if (role === undefined) role = p;
  }
  return { name, flag, role, possiblySameAs };
}

export function parseManifest(text: string): ParsedManifest {
  const src = String(text ?? '');
  try {
    const open = src.indexOf(SENTINEL_OPEN);
    if (open < 0) return { status: 'missing', characters: [], locations: [], stripped: src };

    const close = src.indexOf(SENTINEL_CLOSE, open);
    if (close < 0) {
      // Dangling open: best-effort strip the remnant so nothing bleeds, flag malformed.
      return { status: 'malformed', characters: [], locations: [], stripped: src.slice(0, open).replace(/\n{3,}/g, '\n\n').trimEnd() };
    }

    const body = src.slice(open + SENTINEL_OPEN.length, close);
    const stripped = (src.slice(0, open) + src.slice(close + SENTINEL_CLOSE.length)).replace(/\n{3,}/g, '\n\n');

    const characters: ManifestCharacter[] = [];
    const locations: ManifestLocation[] = [];
    let section: 'characters' | 'locations' | null = null;
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const hdr = /^(CHARACTERS|LOCATIONS):\s*(.*)$/i.exec(line);
      if (hdr) {
        section = hdr[1].toUpperCase() === 'CHARACTERS' ? 'characters' : 'locations';
        continue;
      }
      if (!line.startsWith('-') || !section) continue;
      const row = parseRow(line);
      if (!row) continue;
      if (section === 'characters') characters.push(row);
      else locations.push({ name: row.name, flag: row.flag, role: row.role });
    }

    if (hasManifestResidue(stripped)) return { status: 'residue', characters, locations, stripped };
    const status: ManifestStatus = (characters.length === 0 && locations.length === 0) ? 'empty' : 'ok';
    return { status, characters, locations, stripped };
  } catch {
    // Fail-soft: never throw. Best-effort strip everything from the first open.
    const open = src.indexOf(SENTINEL_OPEN);
    return { status: 'malformed', characters: [], locations: [], stripped: open < 0 ? src : src.slice(0, open).trimEnd() };
  }
}
