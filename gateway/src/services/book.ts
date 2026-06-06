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
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { LibraryService, LibraryEntryFull } from './library.js';
import {
  BOOK_SCHEMA_VERSION, slugify, classifyVersion,
  type BookManifest, type BookSummary, type PulledRef,
} from './book-types.js';

export interface BookSelection {
  title: string;
  author: string;
  genre: string | null;
  pipeline: string;
  sections: string[];
}

export class BookService {
  private booksDir: string;
  private library: LibraryService;
  private appVersion: string;

  constructor(booksDir: string, library: LibraryService, appVersion: string) {
    this.booksDir = booksDir;
    this.library = library;
    this.appVersion = appVersion;
  }

  async initialize(): Promise<void> {
    await mkdir(this.booksDir, { recursive: true });
  }

  async create(sel: BookSelection): Promise<BookManifest> {
    const title = String(sel.title || '').trim();
    if (!title) throw new Error('title is required');

    const author = this.library.get('author', sel.author);
    if (!author || !author.files) throw new Error(`Unknown author template: ${sel.author}`);
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
    if (genre && genre.files) {
      await mkdir(join(dir, 'templates', 'genre'), { recursive: true });
      for (const [file, content] of Object.entries(genre.files)) {
        await writeFile(join(dir, 'templates', 'genre', file), content, 'utf-8');
      }
    }
    await writeFile(join(dir, 'templates', 'pipeline.json'), JSON.stringify(pipeline.pipeline, null, 2) + '\n', 'utf-8');
    if (sectionEntries.length) {
      await mkdir(join(dir, 'templates', 'sections'), { recursive: true });
      for (const s of sectionEntries) {
        await writeFile(join(dir, 'templates', 'sections', `${s.name}.md`), s.content, 'utf-8');
      }
    }
    await mkdir(join(dir, 'data'), { recursive: true });

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
        genre: genre ? ref(sel.genre as string, genre.source) : null,
        pipeline: ref(sel.pipeline, pipeline.source, pipeline.pipeline.schemaVersion),
        sections: sectionEntries.map((s) => s.name),
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
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
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

  private uniqueSlug(base: string): string {
    if (!existsSync(join(this.booksDir, base))) return base;
    for (let i = 2; i < 1000; i++) {
      const cand = `${base}-${i}`;
      if (!existsSync(join(this.booksDir, cand))) return cand;
    }
    return `${base}-${Date.now()}`;
  }
}
