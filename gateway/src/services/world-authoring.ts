/**
 * world-authoring — make an editor session world-aware. Three pure helpers:
 *
 *  - composeWorldAuthoringContext: turns a world's config (format directive +
 *    type/clearance/domain taxonomy + classification scheme) and its document
 *    catalog (title/type/summary/tags — no bodies) into one priming string,
 *    injected into the authoring editor's prompt as the `worldContext` section
 *    (see composeEditorPrompt). Deterministic; no I/O, no AI.
 *
 *  - worldForAuthoringEditor: scans a list of world stubs to find which world
 *    has authoringEditor === editorName. Pure; accepts callbacks for the config
 *    lookup so it can be tested without booting the full gateway.
 *
 *  - proposedDocToCreateInput: maps a reviewed proposed-document payload into the
 *    shape WorldService.createDocument expects, leaving `classification` unset so
 *    the service auto-assigns the next free serial.
 */
import type { LibraryWorld, WorldDocCatalogRow, WorldDocMeta } from './world-types.js';

export function composeWorldAuthoringContext(
  world: LibraryWorld,
  catalog: WorldDocCatalogRow[],
): string {
  const lines: string[] = [];
  const label = world.label ?? world.name;
  lines.push(`You are authoring documents for the world **${label}**. Follow this world's format and taxonomy exactly.`);

  lines.push('');
  lines.push('## Format directive');
  lines.push(world.formatDirective.trim());

  lines.push('');
  lines.push('## Document types (the `type` field must be one of these ids)');
  for (const t of world.documentTypes) {
    lines.push(`- ${t.id} — ${t.label}${t.note ? ` (${t.note})` : ''}`);
  }

  lines.push('');
  lines.push(`## Clearance levels: ${world.clearanceLevels.join(', ')}`);
  lines.push(`## Domains: ${world.domains.join(', ')}`);
  lines.push(`## Classification scheme: ${world.classificationScheme} (serial auto-assigned on save — do not invent the number)`);

  lines.push('');
  lines.push('## Existing documents (catalog — search these for continuity before drafting)');
  if (catalog.length === 0) {
    lines.push('(no documents yet — this is a new repository)');
  } else {
    const CAP = 50;
    const visible = catalog.slice(0, CAP);
    for (const d of visible) {
      const tags = d.tags.length ? ` [${d.tags.join(', ')}]` : '';
      lines.push(`- ${d.classification} · ${d.type} · ${d.title} — ${d.summary}${tags}`);
    }
    if (catalog.length > CAP) {
      lines.push(`(… ${catalog.length - CAP} more documents not shown — use the documents catalog to find them)`);
    }
  }

  return lines.join('\n');
}

/**
 * Scan worlds to find which one has authoringEditor === editorName.
 * Pure; the caller supplies the list + a config-lookup callback so this can be
 * tested without booting the gateway.
 */
export function worldForAuthoringEditor(
  editorName: string,
  worlds: Array<{ name: string }>,
  getConfig: (name: string) => LibraryWorld | undefined,
): LibraryWorld | undefined {
  let first: LibraryWorld | undefined;
  const others: string[] = [];
  for (const w of worlds) {
    const cfg = getConfig(w.name);
    if (cfg?.authoringEditor === editorName) {
      if (first === undefined) {
        first = cfg;
      } else {
        others.push(cfg.name);
      }
    }
  }
  if (first !== undefined && others.length > 0) {
    const all = [first.name, ...others].join(', ');
    console.warn(`  ⚠ World authoring: editor "${editorName}" is the authoringEditor for multiple worlds (${all}); using "${first.name}".`);
  }
  return first;
}

/** A proposed document payload as returned by the authoring editor. */
export interface ProposedDocument {
  title: string;
  type: string;
  clearance: string;
  domain: string;
  attribution?: string;
  tags?: string[];
  summary: string;
  appendixEligible?: boolean;
  body: string;
}

/**
 * Map a reviewed proposed document into WorldService.createDocument's input.
 * `classification` is intentionally omitted so the service auto-assigns the next
 * free serial for the TYPE-DOMAIN pair.
 * classification is intentionally omitted so WorldService auto-assigns the next free serial.
 */
export function proposedDocToCreateInput(
  proposed: ProposedDocument,
): { meta: Omit<WorldDocMeta, 'classification'>; body: string } {
  return {
    meta: {
      title: proposed.title,
      type: proposed.type,
      clearance: proposed.clearance,
      domain: proposed.domain,
      attribution: proposed.attribution,
      tags: proposed.tags ?? [],
      summary: proposed.summary,
      appendixEligible: proposed.appendixEligible,
    },
    body: proposed.body,
  };
}
