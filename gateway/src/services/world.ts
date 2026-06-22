/**
 * WorldService (World Repository Phase 1): config read-through + documents CRUD.
 *
 * World config (world.json) is resolved through LibraryService (built-in +
 * workspace overlay). Documents live in the workspace overlay only —
 * workspace/library/worlds/<name>/documents/<docId>.md — and are owned here
 * (the library overlay deliberately does not load them). Fail-soft: a bad
 * document file surfaces as `needsAttention` in the catalog and never throws.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import type { LibraryService } from './library.js';
import { ENTRY_NAME_RE } from './library.js';
import type { LibrarySource } from './library-types.js';
import type { LibraryWorld, WorldDocMeta, WorldDocument, WorldDocCatalogRow } from './world-types.js';
import { parseWorldDoc, serializeWorldDoc, nextClassification } from './world-parse.js';

/** Derive a filesystem-safe docId stem from a classification + title. */
function deriveDocId(classification: string, title: string): string {
  const slug = `${classification}-${title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
  return slug || classification.toLowerCase();
}

export class WorldService {
  constructor(private library: LibraryService, private workspaceLibraryDir: string) {}

  /** Absolute documents/ dir for a world's workspace overlay, or null if name invalid. */
  private documentsDir(name: string): string | null {
    if (!ENTRY_NAME_RE.test(name)) return null;
    return join(this.workspaceLibraryDir, 'worlds', name, 'documents');
  }

  private docPath(name: string, docId: string): string | null {
    const dir = this.documentsDir(name);
    if (!dir || !ENTRY_NAME_RE.test(docId)) return null;
    return join(dir, `${docId}.md`);
  }

  list(): Array<{ name: string; label?: string; description?: string; source: LibrarySource }> {
    return this.library.list('world').map((row) => {
      const cfg = this.library.get('world', row.name)?.world;
      return { name: row.name, label: cfg?.label, description: row.description, source: row.source };
    });
  }

  getConfig(name: string): LibraryWorld | undefined {
    return this.library.get('world', name)?.world;
  }

  /** All docId stems present in the workspace overlay for a world. */
  private docIds(name: string): string[] {
    const dir = this.documentsDir(name);
    if (!dir || !existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name.replace(/\.md$/, ''));
  }

  listDocuments(name: string): WorldDocCatalogRow[] {
    const dir = this.documentsDir(name);
    if (!dir || !existsSync(dir)) return [];
    const rows: WorldDocCatalogRow[] = [];
    for (const docId of this.docIds(name)) {
      try {
        const raw = readFileSync(join(dir, `${docId}.md`), 'utf-8');
        const { meta } = parseWorldDoc(raw);
        rows.push({
          docId, title: meta.title, type: meta.type, domain: meta.domain,
          clearance: meta.clearance, classification: meta.classification,
          summary: meta.summary, tags: meta.tags, appendixEligible: meta.appendixEligible === true,
        });
      } catch {
        rows.push({
          docId, title: docId, type: '', domain: '', clearance: '', classification: '',
          summary: '', tags: [], appendixEligible: false, needsAttention: true,
        });
      }
    }
    return rows;
  }

  getDocument(name: string, docId: string): WorldDocument | undefined {
    const p = this.docPath(name, docId);
    if (!p || !existsSync(p)) return undefined;
    try {
      const { meta, body } = parseWorldDoc(readFileSync(p, 'utf-8'));
      return { docId, meta, body };
    } catch { return undefined; }
  }

  createDocument(
    name: string,
    input: { meta: Omit<WorldDocMeta, 'classification'> & { classification?: string }; body: string },
  ): WorldDocument {
    const cfg = this.getConfig(name);
    if (!cfg) throw new Error(`world not found: ${name}`);
    const dir = this.documentsDir(name);
    if (!dir) throw new Error(`invalid world name: ${name}`);

    const existingCodes = this.listDocuments(name).map((r) => r.classification).filter(Boolean);
    const classification = input.meta.classification?.trim()
      || nextClassification(cfg.classificationScheme, input.meta.type, input.meta.domain, existingCodes);

    const meta: WorldDocMeta = { ...input.meta, classification };
    const docId = deriveDocId(classification, meta.title);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${docId}.md`), serializeWorldDoc(meta, input.body), 'utf-8');
    return { docId, meta, body: input.body.replace(/\s+$/, '') };
  }

  updateDocument(name: string, docId: string, input: { meta: WorldDocMeta; body: string }): WorldDocument {
    const p = this.docPath(name, docId);
    if (!p || !existsSync(p)) throw new Error(`document not found: ${name}/${docId}`);
    writeFileSync(p, serializeWorldDoc(input.meta, input.body), 'utf-8');
    return { docId, meta: input.meta, body: input.body.replace(/\s+$/, '') };
  }

  deleteDocument(name: string, docId: string): boolean {
    const p = this.docPath(name, docId);
    if (!p || !existsSync(p)) return false;
    rmSync(p);
    return true;
  }
}
