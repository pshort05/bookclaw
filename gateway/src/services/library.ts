/**
 * BookClaw Library Service (book-container Phase 1, read side).
 *
 * A template library mirroring the SkillLoader built-in + workspace-overlay
 * model, across five kinds: author, genre, pipeline, section, skill.
 *   - built-in:   shipped repo `library/` dir, baked into the image (read-only)
 *   - workspace:  `workspace/library/`, user-editable, overrides built-ins by name
 *   - skill:      delegated to SkillLoader (single frontmatter parser, no dup)
 *
 * Phase 1 is READ-ONLY. The editor write-path re-point is Phase 4; book snapshots
 * are Phase 2. Author/genre/section entries are directories of markdown files;
 * pipelines are single JSON files; skills come from SkillLoader's catalog.
 */
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { LibraryKind, LibrarySource, LibraryPipeline } from './library-types.js';

/** Lightweight catalog row for list(). */
export interface LibraryEntry {
  kind: LibraryKind;
  name: string;
  source: LibrarySource;
  description?: string; // pipelines + skills carry one
}

/** Full read for get(): a multi-file kind bundles its files; others carry content. */
export interface LibraryEntryFull extends LibraryEntry {
  files?: Record<string, string>; // author/genre: filename -> content
  content?: string;               // section (md) / skill (SKILL.md)
  pipeline?: LibraryPipeline;     // pipeline: parsed JSON
}

/** Minimal surface of SkillLoader that LibraryService consumes. */
interface SkillCatalogLike {
  getSkillCatalog(): Array<{ name: string; description: string; source: LibrarySource }>;
  getSkillByName(name: string): { content: string; description: string; source: LibrarySource } | undefined;
}

/** Library kinds backed by files on disk — everything except `skill`, which is delegated to SkillLoader. */
const FILE_KINDS = ['author', 'genre', 'pipeline', 'section'] as const;
type FileKind = (typeof FILE_KINDS)[number];

/** Subdirectory under the library root for each file-backed kind. */
const DIR_LAYOUT: Record<FileKind, string> = {
  author: 'authors',
  genre: 'genres',
  pipeline: 'pipelines',
  section: 'sections',
};

export class LibraryService {
  private builtinDir: string;
  private workspaceDir: string;
  private skills: SkillCatalogLike;
  // kind -> (name -> full entry). Skills are not cached here (always live from SkillLoader).
  private entries: Map<FileKind, Map<string, LibraryEntryFull>> = new Map();

  constructor(builtinDir: string, workspaceDir: string, skills: SkillCatalogLike) {
    this.builtinDir = builtinDir;
    this.workspaceDir = workspaceDir;
    this.skills = skills;
  }

  async loadAll(): Promise<void> {
    this.entries.clear();
    for (const kind of FILE_KINDS) {
      const byName = new Map<string, LibraryEntryFull>();
      // built-in first, then workspace overlay overrides by name.
      await this.loadKind(kind, join(this.builtinDir, DIR_LAYOUT[kind]), 'builtin', byName);
      await this.loadKind(kind, join(this.workspaceDir, DIR_LAYOUT[kind]), 'workspace', byName);
      this.entries.set(kind, byName);
    }
  }

  /** Re-read all file-backed kinds from disk (skills reload via SkillLoader.reload()). */
  async reload(): Promise<void> {
    await this.loadAll();
  }

  private async loadKind(
    kind: FileKind,
    dir: string,
    source: LibrarySource,
    out: Map<string, LibraryEntryFull>,
  ): Promise<void> {
    if (!existsSync(dir)) return;
    let items;
    try {
      items = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      // Per-dir fail-soft: an unreadable dir (e.g. an overlay subdir with the
      // wrong ownership) must not abort loading of other kinds or their
      // built-ins — skip just this dir and continue.
      console.warn(`  ⚠ Library: could not read ${kind} dir (${source}) — skipping`, err);
      return;
    }
    for (const item of items) {
      try {
        if (kind === 'pipeline') {
          if (!item.isFile() || !item.name.endsWith('.json')) continue;
          const raw = await readFile(join(dir, item.name), 'utf-8');
          const pipeline = JSON.parse(raw) as LibraryPipeline;
          const name = item.name.replace(/\.json$/, '');
          out.set(name, { kind, name, source, description: pipeline.description, pipeline });
        } else if (kind === 'section') {
          if (!item.isFile() || !item.name.endsWith('.md')) continue;
          const content = await readFile(join(dir, item.name), 'utf-8');
          const name = item.name.replace(/\.md$/, '');
          out.set(name, { kind, name, source, content });
        } else {
          // author / genre: a directory of markdown files.
          if (!item.isDirectory()) continue;
          const sub = await readdir(join(dir, item.name), { withFileTypes: true });
          const files: Record<string, string> = {};
          for (const f of sub) {
            if (f.isFile() && f.name.endsWith('.md')) {
              files[f.name] = await readFile(join(dir, item.name, f.name), 'utf-8');
            }
          }
          out.set(item.name, { kind, name: item.name, source, files });
        }
      } catch (err) {
        console.error(`  ⚠ Library: failed to load ${kind}/${item.name}`, err);
      }
    }
  }

  /** Catalog rows for one kind, or all kinds when kind is omitted. */
  list(kind?: LibraryKind): LibraryEntry[] {
    if (kind === 'skill') return this.listSkills();
    // After the skill branch, a specified kind is a FileKind; the Map lookup
    // returns undefined for anything not loaded, so no extra guard is needed.
    if (kind) {
      return Array.from(this.entries.get(kind)?.values() ?? []).map((e) => this.toRow(e));
    }
    const all: LibraryEntry[] = [];
    for (const k of FILE_KINDS) {
      all.push(...Array.from(this.entries.get(k)?.values() ?? []).map((e) => this.toRow(e)));
    }
    all.push(...this.listSkills());
    return all;
  }

  /** Full read of one entry. */
  get(kind: LibraryKind, name: string): LibraryEntryFull | undefined {
    if (kind === 'skill') {
      const s = this.skills.getSkillByName(name);
      return s ? { kind: 'skill', name, source: s.source, description: s.description, content: s.content } : undefined;
    }
    return this.entries.get(kind)?.get(name);
  }

  getLoadedCount(): number {
    let n = 0;
    for (const byName of this.entries.values()) n += byName.size;
    return n + this.skills.getSkillCatalog().length;
  }

  private listSkills(): LibraryEntry[] {
    return this.skills.getSkillCatalog().map((s) => ({
      kind: 'skill' as const, name: s.name, source: s.source, description: s.description,
    }));
  }

  private toRow(e: LibraryEntryFull): LibraryEntry {
    return { kind: e.kind, name: e.name, source: e.source, description: e.description };
  }
}
