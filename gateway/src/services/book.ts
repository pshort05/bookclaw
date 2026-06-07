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
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import type { LibraryService, LibraryEntryFull } from './library.js';
import {
  BOOK_SCHEMA_VERSION, slugify, classifyVersion,
  type BookManifest, type BookSummary, type PulledRef,
} from './book-types.js';

export interface BookSelection {
  title: string;
  author: string;
  voice: string;
  genre: string | null;
  pipeline: string;
  sections: string[];
}

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
    await mkdir(join(dir, 'templates', 'voice'), { recursive: true });
    for (const [file, content] of Object.entries(voice.files)) {
      await writeFile(join(dir, 'templates', 'voice', file), content, 'utf-8');
    }
    if (genre && genre.files) {
      await mkdir(join(dir, 'templates', 'genre'), { recursive: true });
      for (const [file, content] of Object.entries(genre.files)) {
        await writeFile(join(dir, 'templates', 'genre', file), content, 'utf-8');
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
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return undefined;
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
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return false;
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
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;
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

  /** Absolute templates/author/ dir of the active book, or null. */
  activeAuthorDir(): string | null {
    const d = this.activeBookDir();
    return d ? join(d, 'templates', 'author') : null;
  }

  /** Absolute templates/voice/ dir of the active book, or null. */
  activeVoiceDir(): string | null {
    const d = this.activeBookDir();
    return d ? join(d, 'templates', 'voice') : null;
  }

  /** Absolute data/ dir of the active book (where outputs land), or null. */
  activeDataDir(): string | null {
    const d = this.activeBookDir();
    return d ? join(d, 'data') : null;
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
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`Invalid slug: ${slug}`);
    await rm(join(this.booksDir, slug), { recursive: true, force: true });
    if (this.activeBookSlug === slug) {
      this.activeBookSlug = null;
      await this.seedDefaultBook();
    }
    return { active: this.activeBookSlug };
  }

  /**
   * Parse and return the active book's snapshotted pipeline definition
   * (templates/pipeline.json → LibraryPipeline shape). Null if no active book
   * or the file is missing/corrupt (fail-soft — the caller decides what to do).
   */
  activePipeline(): import('./library-types.js').LibraryPipeline | null {
    const d = this.activeBookDir();
    if (!d) return null;
    const p = join(d, 'templates', 'pipeline.json');
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch (err) {
      console.warn(`  ⚠ Books: could not parse active pipeline.json — ${(err as Error)?.message || err}`);
      return null;
    }
  }
}
