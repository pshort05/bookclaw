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
import { readFile, readdir, writeFile, mkdir, rm } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import type { LibraryKind, LibrarySource, LibraryPipeline, LibrarySequence, LibraryEditor, LibraryPrompt } from './library-types.js';
import type { SkillStep } from '../skills/loader.js';
import { MD_FILE_RE, parsePipelineJson } from './book-types.js';
import { parseSequence } from './sequence-parse.js';
import { parseEditor } from './editor-parse.js';
import { parsePrompt } from './prompt-parse.js';

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
  sequence?: LibrarySequence;     // sequence: parsed JSON
  editor?: LibraryEditor;         // editor: parsed JSON
  prompt?: LibraryPrompt;         // prompt: parsed JSON
  steps?: SkillStep[];            // skill: executable phases (steps.json)
  retries?: number;               // skill: per-phase retry budget
}

/** Minimal surface of SkillLoader that LibraryService consumes. */
interface SkillCatalogLike {
  getSkillCatalog(): Array<{ name: string; description: string; source: LibrarySource }>;
  getSkillByName(name: string): { content: string; description: string; source: LibrarySource; steps?: SkillStep[]; retries?: number } | undefined;
}

/** Library kinds backed by files on disk — everything except `skill`, which is delegated to SkillLoader. */
const FILE_KINDS = ['author', 'voice', 'genre', 'pipeline', 'sequence', 'editor', 'prompt', 'section'] as const;
type FileKind = (typeof FILE_KINDS)[number];

/** Subdirectory under the library root for each file-backed kind. */
const DIR_LAYOUT: Record<FileKind, string> = {
  author: 'authors',
  voice: 'voices',
  genre: 'genres',
  pipeline: 'pipelines',
  sequence: 'sequences',
  editor: 'editors',
  prompt: 'prompts',
  section: 'sections',
};

// MD_FILE_RE is imported from book-types.ts (shared with books.routes.ts).
// ENTRY_NAME_RE intentionally caps at 63 chars for library entry *creation*.
// Book slugs use an uncapped variant because of the -<timestamp> uniqueness fallback.
export const ENTRY_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export interface LibraryWriteBody {
  files?: Record<string, string>; // author/voice/genre
  content?: string;               // section / pipeline (raw JSON text)
  description?: string;           // author/voice/genre/section: sidecar meta.json
}

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

  /** Absolute overlay dir/file path for an entry, or null if name invalid. */
  private overlayPath(kind: FileKind, name: string): string | null {
    if (!ENTRY_NAME_RE.test(name)) return null;
    const dir = join(this.workspaceDir, DIR_LAYOUT[kind]);
    if (kind === 'pipeline' || kind === 'sequence' || kind === 'editor' || kind === 'prompt') return join(dir, `${name}.json`);
    if (kind === 'section') return join(dir, `${name}.md`);
    return join(dir, name); // author/voice/genre: a directory
  }

  /** True if a workspace-overlay entry exists for this kind/name. */
  overlayExists(kind: FileKind, name: string): boolean {
    const p = this.overlayPath(kind, name);
    return !!p && existsSync(p);
  }

  /** Validate + persist an overlay entry. Throws on bad input. Caller reloads. */
  async writeEntry(kind: FileKind, name: string, body: LibraryWriteBody): Promise<void> {
    const target = this.overlayPath(kind, name);
    if (!target) throw new Error(`Invalid name: ${name}`);
    if (kind === 'pipeline') {
      const raw = String(body.content ?? '');
      parsePipelineJson(raw); // throws on invalid JSON or missing steps/schemaVersion
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, raw.endsWith('\n') ? raw : raw + '\n', 'utf-8');
      return;
    }
    if (kind === 'sequence') {
      const raw = String(body.content ?? '');
      parseSequence(JSON.parse(raw)); // throws on invalid JSON or missing/empty pipelines
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, raw.endsWith('\n') ? raw : raw + '\n', 'utf-8');
      return;
    }
    if (kind === 'editor') {
      const raw = String(body.content ?? '');
      parseEditor(JSON.parse(raw)); // throws on invalid JSON or missing name/systemPrompt
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, raw.endsWith('\n') ? raw : raw + '\n', 'utf-8');
      return;
    }
    if (kind === 'prompt') {
      const raw = String(body.content ?? '');
      parsePrompt(JSON.parse(raw)); // throws on invalid JSON or missing name/systemPrompt
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, raw.endsWith('\n') ? raw : raw + '\n', 'utf-8');
      return;
    }
    if (kind === 'section') {
      if (typeof body.content !== 'string') throw new Error('section requires content (string)');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body.content, 'utf-8');
      if (typeof body.description === 'string') {
        const sidecar = join(dirname(target), `${name}.meta.json`);
        await writeFile(sidecar, JSON.stringify({ description: body.description }), 'utf-8');
      }
      return;
    }
    // author / voice / genre: a directory of .md files. Per-file UPSERT that
    // PRESERVES siblings: merge the provided files over the entry's CURRENT
    // resolved files and write the full set into the overlay. This matters when
    // the overlay first shadows a built-in multi-file entry — writing only the
    // edited file would otherwise drop the built-in's other files from the
    // resolved entry (an overlay shadows the built-in by whole entry, not per
    // file). To remove an entry entirely, use deleteOverlayEntry().
    const files = body.files;
    // A description-only write is allowed (no files required); but if files are
    // provided, every entry must be a valid .md file with string content.
    if (files && Object.keys(files).length > 0) {
      for (const fname of Object.keys(files)) {
        if (!MD_FILE_RE.test(fname)) throw new Error(`Invalid file name: ${fname}`);
        if (typeof files[fname] !== 'string') throw new Error(`File content must be a string: ${fname}`);
      }
    } else if (!files || Object.keys(files).length === 0) {
      // No files provided — require at least a description so the write does something.
      if (typeof body.description !== 'string') throw new Error(`${kind} requires at least one .md file`);
    }
    // NOTE (deliberate): this UPSERTs files and never deletes — to drop a single
    // file from an entry, delete the whole overlay (deleteOverlayEntry) and re-add.
    // Also: first-overlaying a built-in snapshots its CURRENT files; files the
    // built-in adds later won't surface through the overlay until it's re-pulled.
    if (files && Object.keys(files).length > 0) {
      const current = this.get(kind, name)?.files ?? {};
      const finalFiles: Record<string, string> = { ...current, ...files };
      await mkdir(target, { recursive: true });
      for (const [fname, content] of Object.entries(finalFiles)) {
        await writeFile(join(target, fname), content, 'utf-8');
      }
    } else if (typeof body.description === 'string') {
      // Description-only write: materialize the currently-resolved .md files into
      // the overlay dir before writing the sidecar. Without this, the overlay would
      // contain only meta.json with no .md files, silently shadowing the builtin's
      // real content and leaving the entry with files: {}.
      const currentFiles = this.get(kind, name)?.files ?? {};
      if (Object.keys(currentFiles).length === 0) {
        // Entry doesn't exist anywhere — a description-only create would produce
        // an empty overlay with no content files. Reject it.
        throw new Error(`invalid: ${kind} requires at least one .md file`);
      }
      await mkdir(target, { recursive: true });
      for (const [fname, content] of Object.entries(currentFiles)) {
        await writeFile(join(target, fname), content, 'utf-8');
      }
    }
    // Persist description sidecar if provided (only for author/voice/genre/section).
    if (typeof body.description === 'string') {
      await mkdir(target, { recursive: true });
      await writeFile(join(target, 'meta.json'), JSON.stringify({ description: body.description }), 'utf-8');
    }
  }

  /** Create a NEW entry; throws if the name already exists in any source. */
  async createEntry(kind: FileKind, name: string, body: LibraryWriteBody): Promise<void> {
    if (!ENTRY_NAME_RE.test(name)) throw new Error(`Invalid name: ${name}`);
    if (this.get(kind, name)) throw new Error(`Entry already exists: ${kind}/${name}`);
    await this.writeEntry(kind, name, body);
  }

  /** Remove a workspace-overlay entry. Returns false if none existed (builtin stays). */
  async deleteOverlayEntry(kind: FileKind, name: string): Promise<boolean> {
    const p = this.overlayPath(kind, name);
    if (!p || !existsSync(p)) return false;
    await rm(p, { recursive: true, force: true });
    return true;
  }

  private readDescriptionSidecar(file: string): string | undefined {
    try {
      if (!existsSync(file)) return undefined;
      const meta = JSON.parse(readFileSync(file, 'utf-8'));
      return typeof meta?.description === 'string' ? meta.description : undefined;
    } catch { return undefined; }
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
        } else if (kind === 'sequence') {
          if (!item.isFile() || !item.name.endsWith('.json')) continue;
          const raw = await readFile(join(dir, item.name), 'utf-8');
          const name = item.name.replace(/\.json$/, '');
          const sequence = parseSequence({ ...JSON.parse(raw), name });
          out.set(name, { kind, name, source, description: sequence.description, sequence });
        } else if (kind === 'editor') {
          if (!item.isFile() || !item.name.endsWith('.json')) continue;
          const raw = await readFile(join(dir, item.name), 'utf-8');
          const name = item.name.replace(/\.json$/, '');
          const editor = parseEditor({ ...JSON.parse(raw), name });
          out.set(name, { kind, name, source, description: editor.description, editor });
        } else if (kind === 'prompt') {
          if (!item.isFile() || !item.name.endsWith('.json')) continue;
          const raw = await readFile(join(dir, item.name), 'utf-8');
          const name = item.name.replace(/\.json$/, '');
          const prompt = parsePrompt({ ...JSON.parse(raw), name });
          out.set(name, { kind, name, source, description: prompt.description, prompt });
        } else if (kind === 'section') {
          if (!item.isFile() || !item.name.endsWith('.md')) continue;
          const content = await readFile(join(dir, item.name), 'utf-8');
          const name = item.name.replace(/\.md$/, '');
          const description = this.readDescriptionSidecar(join(dir, `${name}.meta.json`));
          out.set(name, { kind, name, source, content, ...(description !== undefined ? { description } : {}) });
        } else {
          // author / voice / genre: a directory of markdown files.
          if (!item.isDirectory()) continue;
          const sub = await readdir(join(dir, item.name), { withFileTypes: true });
          const files: Record<string, string> = {};
          for (const f of sub) {
            if (f.isFile() && f.name.endsWith('.md')) {
              files[f.name] = await readFile(join(dir, item.name, f.name), 'utf-8');
            }
          }
          const ownDescription = this.readDescriptionSidecar(join(dir, item.name, 'meta.json'));
          // When the workspace overlay shadows a builtin but has no sidecar of its
          // own, fall back to the builtin's description already in the Map.
          const description = ownDescription ?? out.get(item.name)?.description;
          out.set(item.name, { kind, name: item.name, source, files, ...(description !== undefined ? { description } : {}) });
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
      return s ? {
        kind: 'skill', name, source: s.source, description: s.description, content: s.content,
        ...(s.steps && s.steps.length ? { steps: s.steps, retries: s.retries ?? 0 } : {}),
      } : undefined;
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
