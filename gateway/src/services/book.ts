/**
 * BookClaw Book Service (book-container Phase 2).
 *
 * A book is a self-contained directory under workspace/books/<slug>/:
 *   book.json   — manifest (schemaVersion gates compatibility)
 *   templates/  — SNAPSHOT copied from the resolved library at create time
 *                 (author/*.md, genre/*.md, pipeline.json, sections/*.md)
 *   data/       — generated outputs (populated from Phase 3 on)
 *
 * Phase 2 STORES books; it does not wire them into generation (Phase 3). Skills
 * are not snapshotted yet (Phase 3/4). Reads/writes stay under booksDir.
 */
import { readFile, writeFile, mkdir, rm, cp } from 'fs/promises';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import type { LibraryService, LibraryEntryFull } from './library.js';
import { mergeText } from './merge.js';
import {
  BOOK_SCHEMA_VERSION, WIRED_KINDS, MD_FILE_RE, SLUG_RE, parsePipelineJson, slugify, classifyVersion,
  suggestedNextStep,
  type BookManifest, type BookSummary, type PulledRef, type NextStep,
} from './book-types.js';

export interface BookSelection {
  title: string;
  author: string;
  voice: string;
  genre: string | null;
  pipeline: string;
  sections: string[];
}

export type RepullStatus =
  | 'in-sync' | 'library-updated' | 'locally-edited' | 'diverged'
  | 'library-removed' | 'no-baseline';

export interface RepullAsset {
  kind: 'author' | 'voice' | 'genre' | 'pipeline' | 'section' | 'skill';
  name: string;
  status: RepullStatus;
  libraryPresent: boolean;
  hasBaseline: boolean;
  wired: boolean;
}

export interface RepullResult { hadConflicts: boolean; }

/** The library names used to seed the first-run Default Book. */
const DEFAULT_BOOK_SELECTION: BookSelection = {
  title: 'Default Book',
  author: 'default',
  voice: 'default',
  genre: null,
  pipeline: 'novel-pipeline',
  sections: [],
};

export class BookService {
  private booksDir: string;
  private library: LibraryService;
  private appVersion: string;
  private activeBookSlug: string | null = null;
  private readonly activePtrPath: string;

  constructor(booksDir: string, library: LibraryService, appVersion: string) {
    this.booksDir = booksDir;
    this.library = library;
    this.appVersion = appVersion;
    // The active-book pointer lives next to the books dir under .config so it
    // sits beside projects-state.json and the other workspace config.
    this.activePtrPath = join(dirname(this.booksDir), '.config', 'active-book.json');
  }

  async initialize(): Promise<void> {
    await mkdir(this.booksDir, { recursive: true });
    // Restore the active-book pointer (fail-soft: a missing/corrupt file just
    // means "no active book yet" — the boot seed will resolve one).
    try {
      if (existsSync(this.activePtrPath)) {
        const ptr = JSON.parse(readFileSync(this.activePtrPath, 'utf-8'));
        if (ptr && typeof ptr.slug === 'string' && existsSync(join(this.booksDir, ptr.slug, 'book.json'))) {
          this.activeBookSlug = ptr.slug;
        }
      }
    } catch (err) {
      console.warn('  ⚠ Books: could not read active-book pointer — ignoring', err);
    }
  }

  async create(sel: BookSelection): Promise<BookManifest> {
    const title = String(sel.title || '').trim();
    if (!title) throw new Error('title is required');

    const author = this.library.get('author', sel.author);
    if (!author || !author.files) throw new Error(`Unknown author template: ${sel.author}`);
    const voice = this.library.get('voice', sel.voice);
    if (!voice || !voice.files) throw new Error(`Unknown voice template: ${sel.voice}`);
    const pipeline = this.library.get('pipeline', sel.pipeline);
    if (!pipeline || !pipeline.pipeline) throw new Error(`Unknown pipeline template: ${sel.pipeline}`);
    let genre: LibraryEntryFull | null = null;
    if (sel.genre) {
      genre = this.library.get('genre', sel.genre) ?? null;
      if (!genre || !genre.files) throw new Error(`Unknown genre template: ${sel.genre}`);
    }
    const sectionEntries = (sel.sections || []).map((name) => {
      const s = this.library.get('section', name);
      if (!s || typeof s.content !== 'string') throw new Error(`Unknown section template: ${name}`);
      return { name, content: s.content };
    });

    const slug = this.uniqueSlug(slugify(title));
    const dir = join(this.booksDir, slug);
    const now = new Date().toISOString();

    await mkdir(join(dir, 'templates', 'author'), { recursive: true });
    for (const [file, content] of Object.entries(author.files)) {
      await writeFile(join(dir, 'templates', 'author', file), content, 'utf-8');
    }
    if (typeof author.description === 'string') {
      await writeFile(join(dir, 'templates', 'author', 'meta.json'), JSON.stringify({ description: author.description }), 'utf-8');
    }
    await mkdir(join(dir, 'templates', 'voice'), { recursive: true });
    for (const [file, content] of Object.entries(voice.files)) {
      await writeFile(join(dir, 'templates', 'voice', file), content, 'utf-8');
    }
    if (typeof voice.description === 'string') {
      await writeFile(join(dir, 'templates', 'voice', 'meta.json'), JSON.stringify({ description: voice.description }), 'utf-8');
    }
    if (genre && genre.files) {
      await mkdir(join(dir, 'templates', 'genre'), { recursive: true });
      for (const [file, content] of Object.entries(genre.files)) {
        await writeFile(join(dir, 'templates', 'genre', file), content, 'utf-8');
      }
      if (typeof genre.description === 'string') {
        await writeFile(join(dir, 'templates', 'genre', 'meta.json'), JSON.stringify({ description: genre.description }), 'utf-8');
      }
    }
    await writeFile(join(dir, 'templates', 'pipeline.json'), JSON.stringify(pipeline.pipeline, null, 2) + '\n', 'utf-8');
    // Frozen skills record: snapshot the SKILL.md of each skill the chosen
    // pipeline's steps reference. SkillLoader matching stays global (not driven
    // by this snapshot); a missing skill is skipped fail-soft.
    const skillNames = Array.from(new Set(
      (pipeline.pipeline.steps || [])
        .map((s) => s.skill)
        .filter((n): n is string => typeof n === 'string' && n.length > 0),
    ));
    const snappedSkills: string[] = [];
    for (const name of skillNames) {
      const sk = this.library.get('skill', name);
      if (!sk || typeof sk.content !== 'string') {
        console.warn(`  ⚠ Books: skill "${name}" referenced by pipeline not found — skipping snapshot`);
        continue;
      }
      await mkdir(join(dir, 'templates', 'skills', name), { recursive: true });
      await writeFile(join(dir, 'templates', 'skills', name, 'SKILL.md'), sk.content, 'utf-8');
      snappedSkills.push(name);
    }
    if (sectionEntries.length) {
      await mkdir(join(dir, 'templates', 'sections'), { recursive: true });
      for (const s of sectionEntries) {
        await writeFile(join(dir, 'templates', 'sections', `${s.name}.md`), s.content, 'utf-8');
        const sectionEntry = this.library.get('section', s.name);
        if (typeof sectionEntry?.description === 'string') {
          await writeFile(join(dir, 'templates', 'sections', `${s.name}.meta.json`), JSON.stringify({ description: sectionEntry.description }), 'utf-8');
        }
      }
    }
    await mkdir(join(dir, 'data'), { recursive: true });

    // Phase 4: capture a pristine baseline mirror of the snapshot so re-pull can
    // 3-way-merge (baseline vs the book's edited copy vs the current library).
    // Never edited by the editor — only create() and a successful re-pull write it.
    await cp(join(dir, 'templates'), join(dir, '.baseline'), { recursive: true });

    const ref = (name: string, source: PulledRef['source'], version?: number): PulledRef =>
      ({ name, source, ...(version != null ? { version } : {}) });

    const manifest: BookManifest = {
      id: slug,
      slug,
      title,
      schemaVersion: BOOK_SCHEMA_VERSION,
      createdByApp: this.appVersion,
      lastWrittenByApp: this.appVersion,
      phase: 'planning',
      createdAt: now,
      pulledFrom: {
        author: ref(sel.author, author.source),
        voice: ref(sel.voice, voice.source),
        genre: genre ? ref(sel.genre as string, genre.source) : null,
        pipeline: ref(sel.pipeline, pipeline.source, pipeline.pipeline.schemaVersion),
        sections: sectionEntries.map((s) => s.name),
        skills: snappedSkills,
      },
      history: [{ at: now, event: 'created' }],
    };
    await writeFile(join(dir, 'book.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    return manifest;
  }

  list(): BookSummary[] {
    if (!existsSync(this.booksDir)) return [];
    const out: BookSummary[] = [];
    for (const e of readdirSync(this.booksDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const mf = join(this.booksDir, e.name, 'book.json');
      if (!existsSync(mf)) continue;
      try {
        const m = JSON.parse(readFileSync(mf, 'utf-8'));
        out.push({
          slug: m.slug || e.name,
          title: m.title || e.name,
          phase: m.phase || 'planning',
          schemaVersion: m.schemaVersion ?? 0,
          status: classifyVersion(m.schemaVersion ?? 0),
          createdAt: m.createdAt || '',
          author: m.pulledFrom?.author?.name,
          voice: m.pulledFrom?.voice?.name,
          genre: m.pulledFrom?.genre?.name ?? null,
        });
      } catch (err) {
        console.warn(`  ⚠ Books: could not read ${e.name}/book.json — skipping`, err);
      }
    }
    return out.sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.slug.localeCompare(b.slug),
    );
  }

  async open(slug: string): Promise<{ manifest: BookManifest; status: BookSummary['status'] } | undefined> {
    // Slugs are always slugify()'d at creation (lowercase alnum + hyphen). Reject
    // anything else so a caller-supplied slug (e.g. GET /api/books/:slug, where
    // Express decodes %2e%2e%2f → ../) can never escape booksDir via join().
    if (!SLUG_RE.test(slug)) return undefined;
    const mf = join(this.booksDir, slug, 'book.json');
    if (!existsSync(mf)) return undefined;
    try {
      const manifest = JSON.parse(await readFile(mf, 'utf-8')) as BookManifest;
      return { manifest, status: classifyVersion(manifest.schemaVersion ?? 0) };
    } catch {
      return undefined;
    }
  }

  /** True if a book directory with this slug exists (does NOT require a parseable book.json). */
  exists(slug: string): boolean {
    if (!SLUG_RE.test(slug)) return false;
    return existsSync(join(this.booksDir, slug));
  }

  private uniqueSlug(base: string): string {
    if (!existsSync(join(this.booksDir, base))) return base;
    for (let i = 2; i < 1000; i++) {
      const cand = `${base}-${i}`;
      if (!existsSync(join(this.booksDir, cand))) return cand;
    }
    return `${base}-${Date.now()}`;
  }

  /** Allocate a fresh, collision-free slug from a title (public wrapper over uniqueSlug). */
  allocateSlug(title: string): string {
    return this.uniqueSlug(slugify(title));
  }

  /** The currently-active book slug, or null if none has been set. */
  getActiveBook(): string | null {
    return this.activeBookSlug;
  }

  /**
   * Set the active book and persist the pointer. Rejects an unknown slug.
   * Per decision 6 (data expendable until v6) we do NOT block activation on the
   * book's version-gate status — status stays an informational badge. A non-`ok`
   * book still activates but we log a warning.
   */
  async setActiveBook(slug: string): Promise<void> {
    const opened = await this.open(slug);
    if (!opened) throw new Error(`Unknown book: ${slug}`);
    if (opened.status !== 'ok') {
      console.warn(`  ⚠ Books: activating "${slug}" with status="${opened.status}" (informational only — runs are not blocked)`);
    }
    this.activeBookSlug = slug;
    await mkdir(dirname(this.activePtrPath), { recursive: true });
    await writeFile(this.activePtrPath, JSON.stringify({ slug, at: new Date().toISOString() }, null, 2) + '\n', 'utf-8');
  }

  /** Absolute dir of the active book, or null. */
  activeBookDir(): string | null {
    return this.activeBookSlug ? join(this.booksDir, this.activeBookSlug) : null;
  }

  /** Absolute book dir for a slug (slug-guarded; null if invalid). */
  bookDir(slug: string): string | null {
    if (!SLUG_RE.test(slug)) return null;
    return join(this.booksDir, slug);
  }

  /** Absolute templates/ dir for a slug, or null if the slug is invalid. */
  templatesDir(slug: string): string | null {
    const d = this.bookDir(slug);
    return d ? join(d, 'templates') : null;
  }

  /** Absolute .baseline/ dir for a slug, or null if the slug is invalid. */
  baselineDir(slug: string): string | null {
    const d = this.bookDir(slug);
    return d ? join(d, '.baseline') : null;
  }

  /** Absolute templates/author/ dir for a slug, or null if slug is null/invalid/unknown. */
  authorDirOf(slug: string | null): string | null {
    if (!slug) return null;
    const d = this.bookDir(slug);
    if (!d || !existsSync(join(d, 'book.json'))) return null;
    return join(d, 'templates', 'author');
  }

  /** Absolute templates/voice/ dir for a slug, or null if slug is null/invalid/unknown. */
  voiceDirOf(slug: string | null): string | null {
    if (!slug) return null;
    const d = this.bookDir(slug);
    if (!d || !existsSync(join(d, 'book.json'))) return null;
    return join(d, 'templates', 'voice');
  }

  /** Absolute data/ dir for a slug (where outputs land), or null if slug is null/invalid/unknown. */
  dataDirOf(slug: string | null): string | null {
    if (!slug) return null;
    const d = this.bookDir(slug);
    if (!d || !existsSync(join(d, 'book.json'))) return null;
    return join(d, 'data');
  }

  /** Absolute templates/author/ dir of the active book, or null. */
  activeAuthorDir(): string | null {
    return this.authorDirOf(this.activeBookSlug);
  }

  /** Absolute templates/voice/ dir of the active book, or null. */
  activeVoiceDir(): string | null {
    return this.voiceDirOf(this.activeBookSlug);
  }

  /** Absolute data/ dir of the active book (where outputs land), or null. */
  activeDataDir(): string | null {
    return this.dataDirOf(this.activeBookSlug);
  }

  /**
   * Returns the suggested next step for a book (phase 6e).
   * Derives `phase` from the book manifest and `hasOutput` from whether data/ is non-empty.
   * Returns null if the book doesn't exist or the slug is invalid.
   */
  nextStep(slug: string): NextStep | null {
    const dir = this.bookDir(slug);
    if (!dir || !existsSync(join(dir, 'book.json'))) return null;
    let phase = 'planning';
    try {
      const m = JSON.parse(readFileSync(join(dir, 'book.json'), 'utf-8'));
      if (typeof m?.phase === 'string') phase = m.phase;
    } catch { /* fail-soft: use default 'planning' */ }
    const dataDir = join(dir, 'data');
    let hasOutput = false;
    try {
      if (existsSync(dataDir)) {
        hasOutput = readdirSync(dataDir, { withFileTypes: true })
          .some((e) => e.isFile() && !e.name.startsWith('.'));
      }
    } catch { /* fail-soft */ }
    return { phase, hasOutput, ...suggestedNextStep(phase, hasOutput) };
  }

  /**
   * Lists the book's data/ output files (name, byte size, modified ISO),
   * newest-first. Top-level real files only — dotfiles and subdirectories are
   * skipped, matching nextStep()'s notion of a "real output". Returns null if the
   * slug is invalid or the book doesn't exist; [] when data/ is absent or empty.
   * Lets the Write OutlinePane / Chat list a book's prior outputs without a
   * bound project (Phase 8 will bind projects to books).
   */
  listFiles(slug: string): { name: string; bytes: number; modified: string }[] | null {
    const dir = this.bookDir(slug);
    if (!dir || !existsSync(join(dir, 'book.json'))) return null;
    const dataDir = join(dir, 'data');
    if (!existsSync(dataDir)) return [];
    try {
      return readdirSync(dataDir, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith('.'))
        .map((e) => {
          const st = statSync(join(dataDir, e.name));
          return { name: e.name, bytes: st.size, modified: st.mtime.toISOString() };
        })
        .sort((a, b) => b.modified.localeCompare(a.modified));
    } catch {
      return [];
    }
  }

  /**
   * Composes the genre guide for a given slug (templates/genre/*.md) into a single
   * string for prompt injection (Phase 7/8). Files are ordered canonically
   * (reader-expectations → tropes → themes → beats → must-haves → genre-killers →
   * comps), each under a "## Genre Guide — <Title>" header; any extra .md files
   * follow in alphabetical order. Reads fresh on each call (cheap; always reflects
   * the latest snapshot after a re-pull). Returns null when slug is null/invalid,
   * no genre snapshot exists, or no non-empty genre files are present.
   */
  genreGuideOf(slug: string | null): string | null {
    if (!slug) return null;
    const dir = this.bookDir(slug);
    if (!dir) return null;
    const genreDir = join(dir, 'templates', 'genre');
    if (!existsSync(genreDir)) return null;

    const ORDER = ['reader-expectations', 'tropes', 'themes', 'beats', 'must-haves', 'genre-killers', 'comps'];
    const TITLES: Record<string, string> = {
      'reader-expectations': 'Reader Expectations',
      'tropes': 'Tropes',
      'themes': 'Themes',
      'beats': 'Beats & Obligatory Scenes',
      'must-haves': 'Must-Haves',
      'genre-killers': 'Genre Killers',
      'comps': 'Comparable Titles',
    };

    let names: string[];
    try {
      names = readdirSync(genreDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);
    } catch {
      return null;
    }
    if (names.length === 0) return null;

    const ordered = [
      ...ORDER.filter((n) => names.includes(`${n}.md`)).map((n) => `${n}.md`),
      ...names.filter((f) => !ORDER.includes(f.replace(/\.md$/, ''))).sort(),
    ];

    const parts: string[] = [];
    for (const file of ordered) {
      let body: string;
      try {
        body = readFileSync(join(genreDir, file), 'utf-8').trim();
      } catch {
        continue;
      }
      if (!body) continue;
      const key = file.replace(/\.md$/, '');
      parts.push(`## Genre Guide — ${TITLES[key] ?? key}\n\n${body}`);
    }
    return parts.length ? parts.join('\n\n') : null;
  }

  /**
   * Composes the active book's genre guide (templates/genre/*.md) into a single
   * string for prompt injection (Phase 7). Files are ordered canonically
   * (reader-expectations → tropes → themes → beats → must-haves → genre-killers →
   * comps), each under a "## Genre Guide — <Title>" header; any extra .md files
   * follow in alphabetical order. Reads fresh on each call (cheap; always reflects
   * the latest snapshot after a re-pull or active-book change). Returns null when
   * there is no active book, no genre snapshot, or no non-empty genre files.
   * NOTE: reads the single global active book — keep callers behind this accessor
   * so Phase 8 can swap it to per-context without touching prompt assembly.
   */
  getActiveGenreGuide(): string | null {
    return this.genreGuideOf(this.activeBookSlug);
  }

  /**
   * First-run seed (book-container Phase 3a):
   *  - no books            → create a Default Book (built-in default Author +
   *                          default pipeline) and activate it.
   *  - books but no active → activate the newest by createdAt (list() is sorted
   *                          newest-first).
   *  - active already set  → no-op.
   * Returns the resolved active slug (or null if seeding failed fail-soft).
   */
  async seedDefaultBook(): Promise<string | null> {
    if (this.activeBookSlug) return this.activeBookSlug;
    const books = this.list();
    try {
      if (books.length === 0) {
        const created = await this.create(DEFAULT_BOOK_SELECTION);
        await this.setActiveBook(created.slug);
        console.log(`  ✓ Books: seeded Default Book "${created.slug}" and set active`);
        return created.slug;
      }
      const newest = books[0].slug; // list() sorts newest-first
      await this.setActiveBook(newest);
      console.log(`  ✓ Books: no active book — activated newest "${newest}"`);
      return newest;
    } catch (err) {
      console.error(`  ✗ Books: failed to seed/activate a Default Book — the app has NO active book. Check that the library has author 'default', voice 'default', and pipeline 'novel-pipeline' loaded. Cause: ${(err as Error)?.message || err}`);
      return null;
    }
  }

  /**
   * Delete a book directory. If it was the active book, clear the pointer and
   * re-resolve via seedDefaultBook() (activate newest, or seed a fresh Default
   * Book if none remain). Returns the resulting active slug. The route confirms
   * the book exists before calling.
   */
  async delete(slug: string): Promise<{ active: string | null }> {
    if (!SLUG_RE.test(slug)) throw new Error(`Invalid slug: ${slug}`);
    await rm(join(this.booksDir, slug), { recursive: true, force: true });
    if (this.activeBookSlug === slug) {
      this.activeBookSlug = null;
      await this.seedDefaultBook();
    }
    return { active: this.activeBookSlug };
  }

  /**
   * Parse and return the snapshotted pipeline definition for a given slug
   * (templates/pipeline.json → LibraryPipeline shape). Null if slug is null/invalid,
   * no book exists, or the file is missing/corrupt (fail-soft — caller decides).
   */
  pipelineOf(slug: string | null): import('./library-types.js').LibraryPipeline | null {
    if (!slug) return null;
    const d = this.bookDir(slug);
    if (!d) return null;
    const p = join(d, 'templates', 'pipeline.json');
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch (err) {
      console.warn(`  ⚠ Books: could not parse pipeline.json for "${slug}" — ${(err as Error)?.message || err}`);
      return null;
    }
  }

  /**
   * Parse and return the active book's snapshotted pipeline definition
   * (templates/pipeline.json → LibraryPipeline shape). Null if no active book
   * or the file is missing/corrupt (fail-soft — the caller decides what to do).
   */
  activePipeline(): import('./library-types.js').LibraryPipeline | null {
    return this.pipelineOf(this.activeBookSlug);
  }

  // ── Phase 4: per-asset re-pull from the library ────────────────────────────

  /** The library's current files/content for an asset, normalised to a file map. */
  private libraryFiles(kind: RepullAsset['kind'], name: string): Record<string, string> | null {
    const e = this.library.get(kind, name);
    if (!e) return null;
    if (e.files) return e.files;
    if (kind === 'pipeline' && e.pipeline) return { 'pipeline.json': JSON.stringify(e.pipeline, null, 2) + '\n' };
    if (typeof e.content === 'string') return { [kind === 'section' ? `${name}.md` : 'SKILL.md']: e.content };
    return null;
  }

  /** templates/ (or .baseline/) relative dir for an asset's files. */
  private assetRel(kind: RepullAsset['kind'], name: string): string {
    if (kind === 'pipeline') return '';            // file lives at <root>/pipeline.json
    if (kind === 'section') return 'sections';
    if (kind === 'skill') return join('skills', name);
    return kind;                                   // author/voice/genre dir
  }

  /** Map a library file name to its on-disk name under templates/. */
  private assetFileName(kind: RepullAsset['kind'], libFileName: string, name: string): string {
    if (kind === 'pipeline') return 'pipeline.json';
    if (kind === 'section') return `${name}.md`;
    return libFileName;
  }

  /** Compare two file maps for equality (keys + contents). */
  private sameFiles(a: Record<string, string> | null, b: Record<string, string> | null): boolean {
    if (!a || !b) return a === b;
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every(k => a[k] === b[k]);
  }

  /** Read a templates/ or .baseline/ asset as a file map (keyed by library file name). */
  private readAssetFrom(slug: string, root: 'templates' | '.baseline', kind: RepullAsset['kind'], name: string): Record<string, string> | null {
    const base = this.bookDir(slug);
    if (!base) return null;
    if (kind === 'pipeline') {
      const p = join(base, root, 'pipeline.json');
      return existsSync(p) ? { 'pipeline.json': readFileSync(p, 'utf-8') } : null;
    }
    if (kind === 'section') {
      const p = join(base, root, 'sections', `${name}.md`);
      return existsSync(p) ? { [`${name}.md`]: readFileSync(p, 'utf-8') } : null;
    }
    // author/voice/genre dir, or skill dir (skills/<name>/) — read all .md
    const dir = join(base, root, this.assetRel(kind, name));
    if (!existsSync(dir)) return null;
    const out: Record<string, string> = {};
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.md')) out[f] = readFileSync(join(dir, f), 'utf-8');
    }
    return Object.keys(out).length ? out : null;
  }

  /** The list of snapshotted assets for a book, from its pulledFrom manifest. */
  private async assetsOf(slug: string): Promise<Array<{ kind: RepullAsset['kind']; name: string }>> {
    const opened = await this.open(slug);
    if (!opened) return [];
    const pf = opened.manifest.pulledFrom;
    const out: Array<{ kind: RepullAsset['kind']; name: string }> = [];
    if (pf.author?.name) out.push({ kind: 'author', name: pf.author.name });
    if (pf.pipeline?.name) out.push({ kind: 'pipeline', name: pf.pipeline.name });
    if (pf.voice?.name) out.push({ kind: 'voice', name: pf.voice.name });
    if (pf.genre?.name) out.push({ kind: 'genre', name: pf.genre.name });
    for (const s of pf.sections || []) out.push({ kind: 'section', name: s });
    for (const s of pf.skills || []) out.push({ kind: 'skill', name: s });
    return out;
  }

  /** Per-asset re-pull status for a book. */
  async repullStatus(slug: string): Promise<RepullAsset[]> {
    const assets = await this.assetsOf(slug);
    return assets.map(({ kind, name }) => {
      const lib = this.libraryFiles(kind, name);
      const baseline = this.readAssetFrom(slug, '.baseline', kind, name);
      const book = this.readAssetFrom(slug, 'templates', kind, name);
      const hasBaseline = !!baseline;
      const wired = WIRED_KINDS.has(kind);
      if (!lib) return { kind, name, status: 'library-removed' as const, libraryPresent: false, hasBaseline, wired };
      if (!hasBaseline) return { kind, name, status: 'no-baseline' as const, libraryPresent: true, hasBaseline, wired };
      const locallyEdited = !this.sameFiles(baseline, book);
      const libraryChanged = !this.sameFiles(baseline, lib);
      const status: RepullStatus =
        locallyEdited && libraryChanged ? 'diverged'
        : libraryChanged ? 'library-updated'
        : locallyEdited ? 'locally-edited'
        : 'in-sync';
      return { kind, name, status, libraryPresent: true, hasBaseline, wired };
    });
  }

  /**
   * Re-pull one asset. With a baseline + a text kind: 3-way merge per file,
   * write merged into templates/, advance baseline to the library version.
   * Pipeline + no-baseline fall back to opts.resolution (take-library | keep-book).
   */
  async repull(
    slug: string,
    kind: RepullAsset['kind'],
    name: string,
    opts: { resolution?: 'take-library' | 'keep-book' },
  ): Promise<RepullResult> {
    const base = this.bookDir(slug);
    if (!base) throw new Error(`Invalid slug: ${slug}`);
    const lib = this.libraryFiles(kind, name);
    if (!lib) throw new Error(`Library no longer has ${kind}/${name}`);
    const baseline = this.readAssetFrom(slug, '.baseline', kind, name);
    const book = this.readAssetFrom(slug, 'templates', kind, name);

    const writeMap = async (root: 'templates' | '.baseline', files: Record<string, string>) => {
      const rel = this.assetRel(kind, name);
      const dir = kind === 'pipeline' ? join(base, root) : join(base, root, rel);
      await mkdir(dir, { recursive: true });
      for (const [libName, content] of Object.entries(files)) {
        await writeFile(join(dir, this.assetFileName(kind, libName, name)), content, 'utf-8');
      }
    };

    // Pipeline (JSON) or no baseline → whole-asset keep/take.
    if (kind === 'pipeline' || !baseline) {
      if (opts.resolution !== 'take-library' && opts.resolution !== 'keep-book') {
        throw new Error(`invalid: resolution (take-library|keep-book) required for ${kind}/${name}`);
      }
      const res = opts.resolution;
      if (res === 'take-library' || !book) {
        // take library (also the only sensible action when the book has no files to keep)
        await writeMap('templates', lib);
        await writeMap('.baseline', lib);
      } else { // keep-book with existing book files: advance baseline to the book copy
        await writeMap('.baseline', book);
      }
      await this.updatePulledFrom(slug, kind, name);
      return { hadConflicts: false };
    }

    // Text 3-way merge per file (union of file names across baseline/book/library).
    const names = new Set([...Object.keys(baseline), ...Object.keys(book ?? {}), ...Object.keys(lib)]);
    const mergedFiles: Record<string, string> = {};
    let hadConflicts = false;
    for (const f of names) {
      const b = baseline[f] ?? '';
      const m = (book ?? {})[f] ?? '';
      const t = lib[f] ?? '';
      const { merged, hadConflicts: c } = mergeText(b, m, t);
      mergedFiles[f] = merged;
      if (c) hadConflicts = true;
    }
    await writeMap('templates', mergedFiles);
    await writeMap('.baseline', lib); // baseline advances to the just-pulled library version
    await this.updatePulledFrom(slug, kind, name);
    return { hadConflicts };
  }

  /** Read ONLY the description sidecar for a book's author/voice/genre snapshot. */
  assetDescription(slug: string, kind: 'author' | 'voice' | 'genre'): string | undefined {
    const dir = this.templatesDir(slug);
    if (!dir) return undefined;
    return this.readTemplateSidecar(join(dir, kind, 'meta.json'));
  }

  /** Read a description from a meta.json sidecar; returns undefined on missing/invalid. */
  private readTemplateSidecar(file: string): string | undefined {
    try {
      if (!existsSync(file)) return undefined;
      const meta = JSON.parse(readFileSync(file, 'utf-8'));
      return typeof meta?.description === 'string' ? meta.description : undefined;
    } catch { return undefined; }
  }

  /**
   * Read a book's snapshot for one kind (singular).
   * Returns a shape the API/UI consumes, or null when the asset is absent.
   * - pipeline → { content, wired }
   * - section, no name → { entries: string[], wired }   (lists section names)
   * - section, name → { content, wired } | null
   * - skill, name → { files, wired } | null
   * - author/voice/genre → { files, wired, description? } | null
   */
  readTemplate(slug: string, kind: RepullAsset['kind'], name?: string): { files?: Record<string, string>; content?: string; entries?: string[]; wired: boolean; description?: string } | null {
    const tdir = this.templatesDir(slug);
    if (!tdir) return null;
    const wired = WIRED_KINDS.has(kind);
    if (kind === 'pipeline') {
      const p = join(tdir, 'pipeline.json');
      return existsSync(p) ? { content: readFileSync(p, 'utf-8'), wired } : null;
    }
    if (kind === 'section') {
      if (!name) {
        const dir = join(tdir, 'sections');
        const entries = existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')) : [];
        return { entries, wired };
      }
      const p = join(tdir, 'sections', `${name}.md`);
      if (!existsSync(p)) return null;
      const description = this.readTemplateSidecar(join(tdir, 'sections', `${name}.meta.json`));
      return { content: readFileSync(p, 'utf-8'), wired, ...(description !== undefined ? { description } : {}) };
    }
    // skill (needs name) or author/voice/genre (dir of .md)
    const rel = this.assetRel(kind, name ?? '');
    const dir = join(tdir, rel);
    if (!existsSync(dir)) return null;
    const files: Record<string, string> = {};
    for (const f of readdirSync(dir)) if (f.endsWith('.md')) files[f] = readFileSync(join(dir, f), 'utf-8');
    // Include description sidecar for author/voice/genre (not skill)
    const description = (kind === 'author' || kind === 'voice' || kind === 'genre')
      ? this.readTemplateSidecar(join(dir, 'meta.json'))
      : undefined;
    return { files, wired, ...(description !== undefined ? { description } : {}) };
  }

  /**
   * Write a book's snapshot for one kind (singular). Validates input; throws on
   * bad input (message starts with 'invalid:' so routes map it to 400). Returns
   * { wired }. author/voice writes should trigger soul reload at the call site.
   */
  async writeTemplate(slug: string, kind: RepullAsset['kind'], name: string | undefined, body: { files?: Record<string, string>; content?: string; description?: string }): Promise<{ wired: boolean }> {
    const tdir = this.templatesDir(slug);
    if (!tdir) throw new Error('invalid: no active/valid book');
    const wired = WIRED_KINDS.has(kind);
    if (kind === 'pipeline') {
      const raw = String(body.content ?? '');
      parsePipelineJson(raw); // throws 'pipeline content must be...' on bad input
      await mkdir(tdir, { recursive: true });
      await writeFile(join(tdir, 'pipeline.json'), raw.endsWith('\n') ? raw : raw + '\n', 'utf-8');
      return { wired };
    }
    if (kind === 'section') {
      if (!name || !SLUG_RE.test(name)) throw new Error('invalid: section name required');
      if (typeof body.content !== 'string') throw new Error('invalid: content (string) required');
      await mkdir(join(tdir, 'sections'), { recursive: true });
      await writeFile(join(tdir, 'sections', `${name}.md`), body.content, 'utf-8');
      if (typeof body.description === 'string') {
        await writeFile(join(tdir, 'sections', `${name}.meta.json`), JSON.stringify({ description: body.description }), 'utf-8');
      }
      return { wired };
    }
    if (kind === 'skill') {
      if (!name || !SLUG_RE.test(name)) throw new Error('invalid: skill name required');
    }
    // skill (skills/<name>/) or author/voice/genre (kind dir): a map of .md files
    const files = body.files;
    if (!files || typeof files !== 'object' || Object.keys(files).length === 0) throw new Error('invalid: files (object) required');
    for (const f of Object.keys(files)) {
      if (!MD_FILE_RE.test(f)) throw new Error(`invalid: bad file name ${f}`);
    }
    const dir = join(tdir, this.assetRel(kind, name ?? ''));
    await mkdir(dir, { recursive: true });
    for (const [f, content] of Object.entries(files)) await writeFile(join(dir, f), String(content), 'utf-8');
    // Persist description sidecar for author/voice/genre/section (not skill/pipeline).
    if (typeof body.description === 'string' && (kind === 'author' || kind === 'voice' || kind === 'genre')) {
      await writeFile(join(dir, 'meta.json'), JSON.stringify({ description: body.description }), 'utf-8');
    }
    return { wired };
  }

  /** After a successful re-pull, refresh the manifest's provenance for the asset. */
  private async updatePulledFrom(slug: string, kind: RepullAsset['kind'], name: string): Promise<void> {
    // sections/skills are tracked as name arrays (no per-entry ref); nothing to update.
    if (kind === 'section' || kind === 'skill') return;
    const opened = await this.open(slug);
    if (!opened) return;
    const m = opened.manifest;
    const entry = this.library.get(kind, name);
    const prev = (m.pulledFrom as unknown as Record<string, PulledRef | null | undefined>)[kind];
    const source: PulledRef['source'] = entry?.source ?? prev?.source ?? 'workspace';
    const version = kind === 'pipeline' ? entry?.pipeline?.schemaVersion : undefined;
    const ref: PulledRef = { name, source, ...(version != null ? { version } : {}) };
    if (kind === 'author') m.pulledFrom.author = ref;
    else if (kind === 'voice') m.pulledFrom.voice = ref;
    else if (kind === 'genre') m.pulledFrom.genre = ref;
    else if (kind === 'pipeline') m.pulledFrom.pipeline = ref;
    m.lastWrittenByApp = this.appVersion;
    m.history.push({ at: new Date().toISOString(), event: 'repull', detail: `${kind}/${name}` });
    const dir = this.bookDir(slug);
    if (dir) await writeFile(join(dir, 'book.json'), JSON.stringify(m, null, 2) + '\n', 'utf-8');
  }
}
