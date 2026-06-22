/**
 * Shared types for the World Repository library kind (World Repository Phase 1).
 * Kept separate from world.ts / world-parse.ts so the parser, the service, and
 * the library overlay can all import them without an import cycle.
 */

export const WORLD_SCHEMA_VERSION = 1;

export interface WorldDocumentType {
  id: string;        // e.g. "field-guide" — referenced by document.type
  label: string;     // e.g. "Field Guide"
  note?: string;     // e.g. "practical"
}

/** Per-world config, parsed from worlds/<name>/world.json. */
export interface LibraryWorld {
  schemaVersion: number;
  name: string;                 // dir name; matches ENTRY_NAME_RE
  label?: string;
  description?: string;
  documentTypes: WorldDocumentType[];
  domains: string[];            // e.g. ["GEO","MAG",...]
  clearanceLevels: string[];    // e.g. ["General Access","Restricted","Cloister-Only"]
  classificationScheme: string; // e.g. "{TYPE}-{DOMAIN}-{NNNN}"
  formatDirective: string;      // narrative-only authoring directive
  authoringEditor?: string;     // library editor name (Phase 4)
  stripCodesInAppendix?: boolean; // Phase 5 render setting; default true
}

/** Universal base fields parsed from a document's YAML frontmatter. */
export interface WorldDocMeta {
  title: string;
  type: string;            // must be one of LibraryWorld.documentTypes[].id
  classification: string;  // e.g. "FG-GEO-0141"
  clearance: string;       // should be one of LibraryWorld.clearanceLevels
  domain: string;          // should be one of LibraryWorld.domains
  attribution?: string;
  tags: string[];
  summary: string;
  appendixEligible?: boolean;
}

/** A full document = frontmatter + narrative body, plus its file-stem id. */
export interface WorldDocument {
  docId: string;   // filename stem under documents/, e.g. "fg-geo-0141-geography-…"
  meta: WorldDocMeta;
  body: string;    // markdown after the closing frontmatter fence
}

/** Catalog row used by relevance-pull and the UI (no body — cheap). */
export interface WorldDocCatalogRow {
  docId: string;
  title: string;
  type: string;
  domain: string;
  clearance: string;
  classification: string;
  summary: string;
  tags: string[];
  appendixEligible: boolean;
  needsAttention?: boolean; // set when frontmatter failed to parse cleanly
}
