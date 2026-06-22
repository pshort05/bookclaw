/**
 * Parsers for the World Repository (World Repository Phase 1):
 *   - parseWorldJson    — validates a world.json config (like parsePipelineJson)
 *   - parseWorldDoc     — hand-parses document YAML frontmatter (no yaml dep)
 *   - serializeWorldDoc — round-trips parseWorldDoc
 *   - nextClassification — next free serial for a {TYPE}-{DOMAIN}-{NNNN} scheme
 */
import type { LibraryWorld, WorldDocumentType, WorldDocMeta } from './world-types.js';

/** Validate + shape-check a world.json string. Throws on invalid. */
export function parseWorldJson(raw: string): LibraryWorld {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('world.json must be valid JSON'); }
  const o = (parsed ?? {}) as Record<string, unknown>;

  if (typeof o.schemaVersion !== 'number') throw new Error('world.json: schemaVersion must be a number');
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!name) throw new Error('world.json: name is required');

  if (!Array.isArray(o.documentTypes) || o.documentTypes.length === 0) {
    throw new Error('world.json: documentTypes must be a non-empty array');
  }
  const documentTypes: WorldDocumentType[] = o.documentTypes.map((dt, i) => {
    const t = (dt ?? {}) as Record<string, unknown>;
    const id = typeof t.id === 'string' ? t.id.trim() : '';
    const label = typeof t.label === 'string' ? t.label.trim() : '';
    if (!id || !label) throw new Error(`world.json: documentType[${i}] requires id and label`);
    const out: WorldDocumentType = { id, label };
    if (typeof t.note === 'string' && t.note.trim()) out.note = t.note.trim();
    return out;
  });

  const domains = Array.isArray(o.domains) ? o.domains.filter((d): d is string => typeof d === 'string') : [];
  if (domains.length === 0) throw new Error('world.json: domains must be a non-empty array');
  const clearanceLevels = Array.isArray(o.clearanceLevels) ? o.clearanceLevels.filter((c): c is string => typeof c === 'string') : [];
  if (clearanceLevels.length === 0) throw new Error('world.json: clearanceLevels must be a non-empty array');

  const classificationScheme = typeof o.classificationScheme === 'string' ? o.classificationScheme.trim() : '';
  if (!classificationScheme) throw new Error('world.json: classificationScheme is required');
  const formatDirective = typeof o.formatDirective === 'string' ? o.formatDirective.trim() : '';
  if (!formatDirective) throw new Error('world.json: formatDirective is required');

  const world: LibraryWorld = {
    schemaVersion: o.schemaVersion,
    name,
    documentTypes,
    domains,
    clearanceLevels,
    classificationScheme,
    formatDirective,
  };
  if (typeof o.label === 'string') world.label = o.label;
  if (typeof o.description === 'string') world.description = o.description;
  if (typeof o.authoringEditor === 'string' && o.authoringEditor.trim()) world.authoringEditor = o.authoringEditor.trim();
  if (typeof o.stripCodesInAppendix === 'boolean') world.stripCodesInAppendix = o.stripCodesInAppendix;
  return world;
}

const REQUIRED_FIELDS: ReadonlyArray<keyof WorldDocMeta> = ['title', 'type', 'classification', 'clearance', 'domain', 'summary'];

/** Parse one inline array literal: `[a, b, c]` → ['a','b','c']. Empty → []. */
function parseInlineArray(value: string): string[] {
  const inner = value.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (!inner) return [];
  return inner.split(',').map((s) => s.replace(/^["']|["']$/g, '').trim()).filter(Boolean);
}

/** Strip a surrounding pair of quotes from a scalar value. */
function unquote(value: string): string {
  return value.replace(/^["']|["']$/g, '');
}

/**
 * Hand-parse a world document: `---` frontmatter fence + narrative body.
 * Mirrors skills/loader.ts:182, extended for inline `tags: [a, b]` arrays.
 * Throws on a missing fence or a missing required field.
 */
export function parseWorldDoc(raw: string): { meta: WorldDocMeta; body: string } {
  const fence = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!fence) throw new Error('world document: missing YAML frontmatter fence');

  const fields: Record<string, string> = {};
  let tags: string[] = [];
  for (const line of fence[1].split('\n')) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s?(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim();
    if (key === 'tags') { tags = parseInlineArray(value); continue; }
    fields[key] = unquote(value);
  }

  for (const f of REQUIRED_FIELDS) {
    if (!fields[f]) throw new Error(`world document: required field '${f}' is missing`);
  }

  const meta: WorldDocMeta = {
    title: fields.title,
    type: fields.type,
    classification: fields.classification,
    clearance: fields.clearance,
    domain: fields.domain,
    tags,
    summary: fields.summary,
  };
  if (fields.attribution) meta.attribution = fields.attribution;
  if (fields.appendixEligible !== undefined) meta.appendixEligible = fields.appendixEligible === 'true';

  const body = raw.slice(fence[0].length).replace(/^\n+/, '').replace(/\s+$/, '');
  return { meta, body };
}

/** Derive the classification TYPE abbreviation from a documentType id. */
function typeAbbrev(type: string): string {
  const segments = type.split('-').filter(Boolean);
  if (segments.length > 1) return segments.map((s) => s[0]).join('').toUpperCase();
  return (segments[0] ?? '').slice(0, 2).toUpperCase();
}

export function nextClassification(scheme: string, type: string, domain: string, existing: string[]): string {
  const TYPE = typeAbbrev(type);
  const DOMAIN = domain.toUpperCase();
  const prefix = `${TYPE}-${DOMAIN}-`;
  let max = 0;
  for (const code of existing) {
    if (!code.startsWith(prefix)) continue;
    const serial = Number(code.slice(prefix.length));
    if (Number.isInteger(serial) && serial > max) max = serial;
  }
  const NNNN = String(max + 1).padStart(4, '0');
  return scheme.replace('{TYPE}', TYPE).replace('{DOMAIN}', DOMAIN).replace('{NNNN}', NNNN);
}

/** Serialize a document back to frontmatter + body; round-trips parseWorldDoc. */
export function serializeWorldDoc(meta: WorldDocMeta, body: string): string {
  const lines: string[] = ['---'];
  lines.push(`title: ${meta.title}`);
  lines.push(`type: ${meta.type}`);
  lines.push(`classification: ${meta.classification}`);
  lines.push(`clearance: ${meta.clearance}`);
  lines.push(`domain: ${meta.domain}`);
  if (meta.attribution) lines.push(`attribution: ${meta.attribution}`);
  lines.push(`tags: [${meta.tags.join(', ')}]`);
  lines.push(`summary: ${meta.summary}`);
  if (meta.appendixEligible !== undefined) lines.push(`appendixEligible: ${meta.appendixEligible}`);
  lines.push('---', '', body.replace(/\s+$/, ''), '');
  return lines.join('\n');
}
