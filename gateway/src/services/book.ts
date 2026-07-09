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
import { existsSync, readdirSync, readFileSync, statSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { LibraryService, LibraryEntryFull } from './library.js';
import { mergeText } from './merge.js';
import {
  BOOK_SCHEMA_VERSION, BOOK_MIN_SUPPORTED, WIRED_KINDS, MD_FILE_RE, SLUG_RE, parsePipelineJson, slugify, classifyVersion,
  suggestedNextStep, pipelineNameForPhase, PROJECT_TYPE_PHASE,
  type BookManifest, type BookSummary, type PulledRef, type NextStep, type BookFormat,
} from './book-types.js';
import { resolveStructure, StoryStructureService, type StoryStructure } from './story-structures.js';
import type { Cadence } from './pipeline/gate-cadence.js';
import { pipelinePhases, type LibraryPipeline } from './library-types.js';
import { listRunnerFiles as listRunnerFilesAt } from './runner-files.js';
import type { WorldService } from './world.js';
import { parseWorldDoc, serializeWorldDoc } from './world-parse.js';

export interface BookSelection {
  title: string;
  author: string;
  voice: string;
  genre: string | null;
  pipeline: string;
  /**
   * v2: the ordered list of resolved pipelines the book runs. When present each
   * is snapshotted to templates/pipeline/<name>.json and manifest.pipelineSequence
   * is set to these names (in order); the union of their referenced skills is
   * snapshotted. When absent, the single `pipeline` is used (also written to the
   * new per-name layout with pipelineSequence:[name]).
   */
  pipelines?: Array<{ name: string; pipeline: LibraryPipeline }>;
  sections: string[];
  series?: { id: string; title: string };   // Series Phase A provenance, when created in a series
  worldbuilding?: { characters?: string; places?: string; lore?: string };  // Series Phase B — snapshotted into templates/worldbuilding/
  format?: BookFormat;   // Book Format & Structure — declared at creation, persisted on the manifest
  preferredProvider?: string;  // default AI provider for this book, persisted on the manifest
  preferredModel?: string;     // default model id for the chosen provider, persisted on the manifest
  contentCeiling?: { spice: number; violence: number };  // explicit content axes; overrides the bound author's contentBrand when set
  uncensoredProvider?: 'grok' | 'venice' | 'auto';        // preferred spice-reroute provider, persisted on the manifest
  reviewCadence?: Cadence;  // explicit human-review gate cadence; overrides the bound author's reviewCadence when set (Flagship Plan 5)
  costBudget?: number;      // per-book spend cap in dollars (Flagship Plan 6, Task 3); persisted on the manifest
  ensemble?: { enabled?: boolean; panel?: string[] };  // opt-in ideation-ensemble override (Flagship Plan 8, Task 3); persisted on the manifest
  seeds?: { storyArc?: string; characters?: string; setting?: string; councilSelection?: 'auto' | 'propose' };  // Romance Workflow Foundation — persisted on the manifest, developed by the pipeline front half
}

export type RepullStatus =
  | 'in-sync' | 'library-updated' | 'locally-edited' | 'diverged'
  | 'library-removed' | 'no-baseline';

export interface RepullAsset {
  kind: 'author' | 'voice' | 'genre' | 'pipeline' | 'section' | 'skill' | 'world';
  name: string;
  status: RepullStatus;
  libraryPresent: boolean;
  hasBaseline: boolean;
  wired: boolean;
}

export interface RepullResult { hadConflicts: boolean; }

/**
 * Compose a set of genre `.md` files (filename → content) into a single,
 * header-delimited prompt string. Canonical sections come first in fixed order;
 * any extra files follow alphabetically. Empty files are dropped; returns null
 * when nothing non-empty remains. Shared by the per-book snapshot path
 * (genreGuideOf) and the per-channel library selection (getChannelGenreGuide).
 */
function composeGenreGuide(files: Record<string, string>): string | null {
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
  const names = Object.keys(files).filter((n) => n.endsWith('.md'));
  if (names.length === 0) return null;

  const ordered = [
    ...ORDER.filter((n) => names.includes(`${n}.md`)).map((n) => `${n}.md`),
    ...names.filter((f) => !ORDER.includes(f.replace(/\.md$/, ''))).sort(),
  ];

  const parts: string[] = [];
  for (const file of ordered) {
    const body = (files[file] ?? '').trim();
    if (!body) continue;
    const key = file.replace(/\.md$/, '');
    parts.push(`## Genre Guide — ${TITLES[key] ?? key}\n\n${body}`);
  }
  return parts.length ? parts.join('\n\n') : null;
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
  // Phase 10: per-channel active-book overrides (channel → slug). Persisted so a
  // Telegram chat's selection survives restarts; resolution falls back to the
  // global pointer for any channel without an override (web/default included).
  private channelBooks: Map<string, string> = new Map();
  private readonly channelPtrPath: string;
  // Per-channel genre selection (channel → library genre name). Persisted beside
  // the active-book pointers; used to steer chat prompts and pre-fill new books.
  private channelGenres: Map<string, string> = new Map();
  private readonly channelGenrePath: string;
  // World Repository Phase 3: optional WorldService reference (setter-injected),
  // used by the re-pull library side to read world documents. Fail-soft when
  // absent — world assets classify `library-removed` rather than throwing.
  private worldService: WorldService | null = null;

  constructor(booksDir: string, library: LibraryService, appVersion: string) {
    this.booksDir = booksDir;
    this.library = library;
    this.appVersion = appVersion;
    // The active-book pointer lives next to the books dir under .config so it
    // sits beside projects-state.json and the other workspace config.
    this.activePtrPath = join(dirname(this.booksDir), '.config', 'active-book.json');
    this.channelPtrPath = join(dirname(this.booksDir), '.config', 'channel-books.json');
    this.channelGenrePath = join(dirname(this.booksDir), '.config', 'channel-genres.json');
  }

  async initialize(): Promise<void> {
    await mkdir(this.booksDir, { recursive: true });
    // Reset in-memory state first: initialize() is re-run after a backup restore,
    // and a restore that removed/changed the pointer files must not leave stale
    // bindings to books that no longer exist.
    this.activeBookSlug = null;
    this.channelBooks.clear();
    this.channelGenres.clear();
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
    // Phase 10: restore per-channel overrides, pruning any whose book is gone
    // (or whose slug is malformed). A non-object file is treated as empty and
    // rewritten clean on the next persist.
    try {
      if (existsSync(this.channelPtrPath)) {
        const raw = JSON.parse(readFileSync(this.channelPtrPath, 'utf-8'));
        const obj = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
        let pruned = obj !== raw; // raw wasn't a plain object → rewrite it clean
        for (const [ch, slug] of Object.entries(obj)) {
          if (typeof slug === 'string' && this.isExistingBookSlug(slug)) {
            this.channelBooks.set(ch, slug);
          } else {
            pruned = true;
          }
        }
        if (pruned) await this.persistChannelBooks();
      }
    } catch (err) {
      console.warn('  ⚠ Books: could not read channel-books overrides — ignoring', err);
    }
    // Restore per-channel genre selections, pruning any whose genre is gone from
    // the library (fail-soft, same posture as the channel-books overrides).
    try {
      if (existsSync(this.channelGenrePath)) {
        const raw = JSON.parse(readFileSync(this.channelGenrePath, 'utf-8'));
        const obj = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
        let pruned = obj !== raw; // raw wasn't a plain object → rewrite it clean
        for (const [ch, name] of Object.entries(obj)) {
          if (typeof name === 'string' && this.library.get('genre', name)) {
            this.channelGenres.set(ch, name);
          } else {
            pruned = true;
          }
        }
        if (pruned) await this.persistChannelGenres();
      }
    } catch (err) {
      console.warn('  ⚠ Books: could not read channel-genres selections — ignoring', err);
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
    // Resolve the ordered pipeline sequence: caller-supplied list (v2) or the
    // single `pipeline` selection (back-compat — still written to the new layout).
    const orderedPipelines: Array<{ name: string; pipeline: LibraryPipeline; source: PulledRef['source'] }> =
      (sel.pipelines && sel.pipelines.length)
        ? sel.pipelines.map((p) => {
            const e = this.library.get('pipeline', p.name);
            return { name: p.name, pipeline: p.pipeline, source: (e?.source ?? pipeline.source) };
          })
        : [{ name: sel.pipeline, pipeline: pipeline.pipeline, source: pipeline.source }];
    const pipelineSequence = orderedPipelines.map((p) => p.name);
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

    // Claim the slug by atomically creating its dir (the dir-claim is the lock
    // against a concurrent same-title create — see claimSlug). booksDir must
    // exist first; initialize() makes it, but guard for a direct create() too.
    mkdirSync(this.booksDir, { recursive: true });
    const slug = this.claimSlug(slugify(title));
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
    // v2 snapshot layout: one templates/pipeline/<name>.json per sequence entry.
    await mkdir(join(dir, 'templates', 'pipeline'), { recursive: true });
    for (const p of orderedPipelines) {
      await writeFile(join(dir, 'templates', 'pipeline', `${p.name}.json`), JSON.stringify(p.pipeline, null, 2) + '\n', 'utf-8');
    }
    // Frozen skills record: snapshot the SKILL.md of each skill referenced across
    // ALL sequence pipelines' steps (union). SkillLoader matching stays global
    // (not driven by this snapshot); a missing skill is skipped fail-soft.
    const skillNames = Array.from(new Set(
      orderedPipelines.flatMap((p) => (p.pipeline.steps || [])
        .map((s) => s.skill)
        .filter((n): n is string => typeof n === 'string' && n.length > 0)),
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
    // Series Phase B: snapshot the series' world-building (non-empty files only),
    // BEFORE the .baseline cp below so the baseline captures it too.
    if (sel.worldbuilding) {
      const wb = sel.worldbuilding;
      const entries = (['characters', 'places', 'lore'] as const).filter((k) => typeof wb[k] === 'string' && wb[k]!.length > 0);
      if (entries.length) {
        await mkdir(join(dir, 'templates', 'worldbuilding'), { recursive: true });
        for (const k of entries) await writeFile(join(dir, 'templates', 'worldbuilding', `${k}.md`), wb[k]!, 'utf-8');
      }
    }
    await mkdir(join(dir, 'data'), { recursive: true });

    // Phase 4: capture a pristine baseline mirror of the snapshot so re-pull can
    // 3-way-merge (baseline vs the book's edited copy vs the current library).
    // Never edited by the editor — only create() and a successful re-pull write it.
    await cp(join(dir, 'templates'), join(dir, '.baseline'), { recursive: true });

    const ref = (name: string, source: PulledRef['source'], version?: number): PulledRef =>
      ({ name, source, ...(version != null ? { version } : {}) });

    // Content ceiling: an explicit per-book value wins; otherwise inherit the
    // bound author's contentBrand (spiceCeiling/violenceCeiling) when set.
    // Absent either way → no contentCeiling → fade-to-black, untouched by the
    // heat_check/intimacy routing (Flagship Plan 2).
    const contentCeiling = sel.contentCeiling
      ?? (author.contentBrand ? { spice: author.contentBrand.spiceCeiling, violence: author.contentBrand.violenceCeiling } : undefined);

    // Review cadence (Flagship Plan 5): same precedence as contentCeiling — an
    // explicit per-book value wins; otherwise inherit the bound author's
    // reviewCadence when set. Absent either way → no review.cadence on the
    // manifest → resolveCadence falls back to 'per_act' (today's behavior).
    const reviewCadence = sel.reviewCadence ?? author.reviewCadence;

    const manifest: BookManifest = {
      id: slug,
      slug,
      title,
      schemaVersion: BOOK_SCHEMA_VERSION,
      createdByApp: this.appVersion,
      lastWrittenByApp: this.appVersion,
      phase: 'planning',
      pipelineSequence,
      createdAt: now,
      pulledFrom: {
        author: ref(sel.author, author.source),
        voice: ref(sel.voice, voice.source),
        genre: genre ? ref(sel.genre as string, genre.source) : null,
        pipeline: ref(orderedPipelines[0].name, orderedPipelines[0].source, orderedPipelines[0].pipeline.schemaVersion),
        sections: sectionEntries.map((s) => s.name),
        skills: snappedSkills,
        ...(sel.series ? { series: { id: sel.series.id, title: sel.series.title } } : {}),
      },
      ...(sel.format ? { format: sel.format } : {}),
      ...(sel.preferredProvider ? { preferredProvider: sel.preferredProvider } : {}),
      ...(sel.preferredModel ? { preferredModel: sel.preferredModel } : {}),
      ...(contentCeiling ? { contentCeiling } : {}),
      ...(sel.uncensoredProvider ? { uncensoredProvider: sel.uncensoredProvider } : {}),
      ...(reviewCadence ? { review: { cadence: reviewCadence } } : {}),
      ...(typeof sel.costBudget === 'number' ? { costBudget: sel.costBudget } : {}),
      ...(sel.ensemble ? { ensemble: sel.ensemble } : {}),
      ...(sel.seeds ? { seeds: sel.seeds } : {}),
      history: [{ at: now, event: 'created' }],
    };
    await writeFile(join(dir, 'book.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    return manifest;
  }

  /** Persist the declared format block onto an existing book's manifest. */
  async setFormat(slug: string, format: BookFormat): Promise<BookManifest> {
    const opened = await this.open(slug);
    if (!opened) throw new Error(`book not found: ${slug}`);
    const { manifest } = opened;
    await this.assertWritable(slug);
    manifest.format = format;
    manifest.history.push({ at: new Date().toISOString(), event: 'format-set', detail: `${format.formId}/${format.structureId} ${format.chapterCount}×${format.wordsPerChapter}` });
    await writeFile(join(this.booksDir, slug, 'book.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    return manifest;
  }

  async setConsistencyModel(slug: string, sel: { provider?: string; model?: string }): Promise<BookManifest> {
    const opened = await this.open(slug);
    if (!opened) throw new Error(`book not found: ${slug}`);
    const { manifest } = opened;
    await this.assertWritable(slug);
    const provider = sel?.provider?.trim();
    const model = sel?.model?.trim();
    if (provider) manifest.consistency = model ? { provider, model } : { provider };
    else delete manifest.consistency;
    manifest.history.push({ at: new Date().toISOString(), event: 'consistency-model-set', detail: provider ? (model ? `${provider}/${model}` : provider) : 'auto' });
    await writeFile(join(this.booksDir, slug, 'book.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    return manifest;
  }

  /**
   * Derive generation inputs from the declared format: per-chapter target, chapter
   * count, and a structure "rail" instruction (beats + expected positions) for the
   * outline prompt. Returns null when the book has no declared format (fail-soft —
   * generation then behaves exactly as before this feature).
   */
  formatGuideFor(slug: string): { chapterCount: number; wordsPerChapter: number; structureRail: string } | null {
    try {
      const p = join(this.booksDir, slug, 'book.json');
      if (!existsSync(p)) return null;
      const m = JSON.parse(readFileSync(p, 'utf-8')) as BookManifest;
      const f = m.format;
      if (!f) return null;
      const structure = resolveStructure(
        { structureId: f.structureId, customStructure: f.customStructure as StoryStructure | undefined },
        new StoryStructureService(),
      );
      const rail = structure && structure.beats.length
        ? `Plan the outline to the "${structure.name}" structure. Hit these beats at roughly these positions (% of the book):\n` +
          structure.beats.map(b => `- ${b.name} (~${b.expectedPct}%): ${b.description}`).join('\n')
        : '';
      return { chapterCount: f.chapterCount, wordsPerChapter: f.wordsPerChapter, structureRail: rail };
    } catch { return null; }
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
          pipeline: m.pulledFrom?.pipeline?.name,
          series: m.pulledFrom?.series?.title ?? undefined,
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
      await this.migrateBookToV2(join(this.booksDir, slug), manifest);
      return { manifest, status: classifyVersion(manifest.schemaVersion ?? 0) };
    } catch {
      return undefined;
    }
  }

  /**
   * Lazy v1 -> v2 migration (config-not-code pipelines). A v1 book has a single
   * templates/pipeline.json and no pipelineSequence; v2 splits each sequence
   * pipeline into templates/pipeline/<name>.json and records pipelineSequence.
   *
   * No-op when already v2+. Otherwise wraps the legacy single pipeline into the
   * new layout (name from its `name`, else "pipeline"), sets pipelineSequence +
   * schemaVersion=2, and persists book.json. Mutates `manifest` in place so the
   * caller sees the bumped values. Fail-soft: a migration error logs ⚠ and leaves
   * the book readable (never throws).
   */
  private async migrateBookToV2(dir: string, manifest: BookManifest): Promise<void> {
    const v = manifest.schemaVersion ?? 0;
    if (v >= 2) return;                    // already v2+
    if (v < BOOK_MIN_SUPPORTED) return;    // too old (quarantined) — leave for the gate, don't migrate
    try {
      const legacy = join(dir, 'templates', 'pipeline.json');
      let name = 'pipeline';
      // Only a book with a real legacy pipeline.json can be wrapped into the v2
      // layout; without one there is no snapshot to point pipelineSequence at, so
      // leave the book unmigrated rather than claiming a nonexistent 'pipeline'.
      if (!existsSync(legacy)) return;
      {
        const legacyContent = readFileSync(legacy, 'utf-8');
        const parsed = JSON.parse(legacyContent) as { name?: unknown };
        if (typeof parsed.name === 'string' && parsed.name.trim()) name = parsed.name.trim();
        await mkdir(join(dir, 'templates', 'pipeline'), { recursive: true });
        await writeFile(join(dir, 'templates', 'pipeline', `${name}.json`), legacyContent, 'utf-8');

        // F3: also migrate the re-pull baseline to the v2 per-name layout, else
        // repullStatus reports 'no-baseline' and loses 3-way merge. Prefer the v1
        // pristine baseline (.baseline/pipeline.json); seed from the templates
        // content when the book has none.
        const legacyBaseline = join(dir, '.baseline', 'pipeline.json');
        const baselineContent = existsSync(legacyBaseline) ? readFileSync(legacyBaseline, 'utf-8') : legacyContent;
        await mkdir(join(dir, '.baseline', 'pipeline'), { recursive: true });
        await writeFile(join(dir, '.baseline', 'pipeline', `${name}.json`), baselineContent, 'utf-8');
      }
      manifest.pipelineSequence = [name];
      manifest.schemaVersion = 2;
      manifest.lastWrittenByApp = this.appVersion;
      manifest.history = manifest.history ?? [];
      manifest.history.push({ at: new Date().toISOString(), event: 'migrate', detail: 'v1->v2' });
      await writeFile(join(dir, 'book.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    } catch (err) {
      console.warn(`  ⚠ Books: v1->v2 migration failed for "${manifest.slug}" — leaving readable. ${(err as Error)?.message || err}`);
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

  /**
   * Atomically claim a fresh slug by CREATING its dir non-recursively: mkdir
   * without recursive throws EEXIST on collision, so the dir-claim is the lock —
   * two concurrent same-title creates can't pick the same slug and clobber
   * (the loser retries the next candidate). Returns the claimed slug; the
   * now-existing dir is reused by create()'s later recursive mkdirs.
   */
  private claimSlug(base: string): string {
    const candidates = [base, ...Array.from({ length: 998 }, (_, i) => `${base}-${i + 2}`), `${base}-${Date.now()}`];
    for (const cand of candidates) {
      try {
        mkdirSync(join(this.booksDir, cand)); // non-recursive: throws EEXIST if taken
        return cand;
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') continue;
        throw err;
      }
    }
    throw new Error(`Could not allocate a unique slug for "${base}"`);
  }

  /**
   * Allocate a fresh slug from a title and atomically claim it by creating its
   * dir (BUG M7). Uses the same non-recursive mkdirSync lock as claimSlug so two
   * concurrent same-title allocations can't return the same slug — the loser
   * retries the next candidate. The now-existing dir is reused by create().
   */
  allocateSlug(title: string): string {
    return this.claimSlug(slugify(title));
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

  /** The raw per-channel override for a channel, or null (no fallback). */
  getChannelBook(channel: string): string | null {
    return this.channelBooks.get(channel) ?? null;
  }

  /** Resolve the effective book for a channel: its override, else the global active book. */
  resolveBook(channel: string): string | null {
    return this.channelBooks.get(channel) ?? this.activeBookSlug;
  }

  /** True if a slug is well-formed AND names a book that exists on disk. */
  private isExistingBookSlug(slug: string): boolean {
    return SLUG_RE.test(slug) && existsSync(join(this.booksDir, slug, 'book.json'));
  }

  /** Pin a channel to a book and persist. Rejects an unknown slug. */
  async setChannelBook(channel: string, slug: string): Promise<void> {
    if (!this.isExistingBookSlug(slug)) {
      throw new Error(`Unknown book: ${slug}`);
    }
    this.channelBooks.set(channel, slug);
    await this.persistChannelBooks();
  }

  /** Drop a channel's override (e.g. reset to default) and persist if it existed. */
  async clearChannelBook(channel: string): Promise<void> {
    if (this.channelBooks.delete(channel)) await this.persistChannelBooks();
  }

  /** Write the per-channel overrides to .config/channel-books.json. */
  private async persistChannelBooks(): Promise<void> {
    await mkdir(dirname(this.channelPtrPath), { recursive: true });
    const obj = Object.fromEntries(this.channelBooks);
    await writeFile(this.channelPtrPath, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  }

  /** The genre selected for a channel, or null if none is set. */
  getChannelGenre(channel: string): string | null {
    return this.channelGenres.get(channel) ?? null;
  }

  /** Pin a library genre (by canonical name) to a channel and persist. */
  async setChannelGenre(channel: string, name: string): Promise<void> {
    if (!this.library.get('genre', name)) {
      throw new Error(`Unknown genre: ${name}`);
    }
    this.channelGenres.set(channel, name);
    await this.persistChannelGenres();
  }

  /** Drop a channel's genre selection and persist if it existed. */
  async clearChannelGenre(channel: string): Promise<void> {
    if (this.channelGenres.delete(channel)) await this.persistChannelGenres();
  }

  /** Write the per-channel genre selections to .config/channel-genres.json. */
  private async persistChannelGenres(): Promise<void> {
    await mkdir(dirname(this.channelGenrePath), { recursive: true });
    const obj = Object.fromEntries(this.channelGenres);
    await writeFile(this.channelGenrePath, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
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

  /**
   * Absolute data/ dir for a slug (where outputs land), or null if slug is
   * null/invalid/unknown.
   * NOTE (schemaVersion gate, Phase-3 deferral): this does NOT enforce the
   * version gate. Template writes are gated (writeTemplate/repull throw on a
   * non-`ok` book via assertWritable), but the engine's data-output path is
   * cross-cutting — gating it would affect many callers — so enforcement here is
   * deferred to the first v1→v2 schema bump (today every book is `ok`, so the
   * gate is unreachable regardless). See classifyVersion in book-types.ts.
   */
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
   * Prompt Runner file listing: a book's data/ outputs + templates/ snapshots,
   * with book-root-relative paths + group. Null if the book is missing.
   */
  listRunnerFiles(slug: string): import('./runner-files.js').RunnerFile[] | null {
    const dir = this.bookDir(slug);
    if (!dir || !existsSync(join(dir, 'book.json'))) return null;
    return listRunnerFilesAt(dir);
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

    let names: string[];
    try {
      names = readdirSync(genreDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name);
    } catch {
      return null;
    }
    if (names.length === 0) return null;

    const files: Record<string, string> = {};
    for (const name of names) {
      try {
        files[name] = readFileSync(join(genreDir, name), 'utf-8');
      } catch { /* skip unreadable file */ }
    }
    return composeGenreGuide(files);
  }

  /**
   * Compose the genre guide for the genre selected on a channel (the /genre
   * command). Reads the genre's files from the live library (not a book
   * snapshot) so free chat with no book still gets genre context. Null when the
   * channel has no selection or the genre is gone from the library.
   */
  getChannelGenreGuide(channel: string): string | null {
    const name = this.channelGenres.get(channel);
    if (!name) return null;
    const entry = this.library.get('genre', name);
    if (!entry || !entry.files) return null;
    return composeGenreGuide(entry.files);
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
   * Composes a book's world-building snapshot (templates/worldbuilding/*.md) into a
   * single string for prompt injection (Series Phase B). Ordered characters →
   * places → lore, each under a "## World-Building — <Title>" header; extra .md
   * files follow alphabetically. Reads fresh each call. Null when slug is
   * null/invalid, no snapshot exists, or no non-empty files are present.
   */
  worldbuildingOf(slug: string | null): string | null {
    if (!slug) return null;
    const dir = this.bookDir(slug);
    if (!dir) return null;
    const wbDir = join(dir, 'templates', 'worldbuilding');
    if (!existsSync(wbDir)) return null;

    const ORDER = ['characters', 'places', 'lore'];
    const TITLES: Record<string, string> = { characters: 'Characters', places: 'Places', lore: 'Lore' };
    let names: string[];
    try {
      names = readdirSync(wbDir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name);
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
      try { body = readFileSync(join(wbDir, file), 'utf-8').trim(); } catch { continue; }
      if (!body) continue;
      const key = file.replace(/\.md$/, '');
      parts.push(`## World-Building — ${TITLES[key] ?? key}\n\n${body}`);
    }
    return parts.length ? parts.join('\n\n') : null;
  }

  /** The active book's composed world-building (Series Phase B). */
  getActiveWorldbuilding(): string | null {
    return this.worldbuildingOf(this.activeBookSlug);
  }

  /**
   * World Repository Phase 3: inject a WorldService so the re-pull library side
   * can read world documents. Optional/fail-soft — unit tests that don't exercise
   * world re-pull can omit it (world assets then classify `library-removed`).
   */
  setWorldService(world: WorldService): void {
    this.worldService = world;
  }

  /**
   * Composes a book's curated world-doc snapshot (templates/world/*.md BODIES,
   * codes kept for AI context) into a single string for prompt injection (World
   * Repository Phase 3). Each doc goes under a "## World Document — <title>"
   * header (title from the snapshotted frontmatter; on parse failure the docId
   * stem is the title and the raw file is the body — fail-soft, never throws).
   * Skips world.json. Alphabetical by docId. Reads fresh each call. Null when
   * slug is null/invalid, no templates/world dir, or no non-empty bodies.
   */
  worldDocsOf(slug: string | null): string | null {
    if (!slug) return null;
    const dir = this.bookDir(slug);
    if (!dir) return null;
    const wdir = join(dir, 'templates', 'world');
    if (!existsSync(wdir)) return null;
    let names: string[];
    try {
      names = readdirSync(wdir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name)
        .sort();
    } catch {
      return null;
    }
    if (names.length === 0) return null;
    const parts: string[] = [];
    for (const file of names) {
      let raw: string;
      try { raw = readFileSync(join(wdir, file), 'utf-8'); } catch { continue; }
      let title: string;
      let body: string;
      try {
        const parsed = parseWorldDoc(raw);
        title = parsed.meta.title || file.replace(/\.md$/, '');
        body = parsed.body.trim();
      } catch {
        title = file.replace(/\.md$/, '');
        body = raw.trim();
      }
      if (!body) continue;
      parts.push(`## World Document — ${title}\n\n${body}`);
    }
    return parts.length ? parts.join('\n\n') : null;
  }

  /** The active book's composed world docs (World Repository Phase 3). */
  getActiveWorldDocs(): string | null {
    return this.worldDocsOf(this.activeBookSlug);
  }

  /**
   * World Repository Phase 3: snapshot the curated world bible for a book.
   * Replaces templates/world/ with world.json + one <docId>.md per resolved doc,
   * mirrors it into .baseline/world/ for 3-way re-pull, then sets the manifest's
   * pulledFrom.world + worldDocs and appends a `world-pull` history entry. The
   * (de)serialization is delegated through closures so the route owns the
   * WorldService accessor surface. Schema-gated via assertWritable (matches repull).
   */
  async snapshotWorldDocs(
    slug: string,
    world: { name: string; source: PulledRef['source'] },
    docIds: string[],
    getConfigRaw: (name: string) => string | null,
    getDocSerialized: (name: string, docId: string) => string | null,
  ): Promise<{ written: string[]; missing: string[] }> {
    await this.assertWritable(slug);
    const base = this.bookDir(slug);
    if (!base) throw new Error(`Invalid slug: ${slug}`);

    const worldTpl = join(base, 'templates', 'world');
    const worldBase = join(base, '.baseline', 'world');
    await rm(worldTpl, { recursive: true, force: true });
    await rm(worldBase, { recursive: true, force: true });
    await mkdir(worldTpl, { recursive: true });

    const cfg = getConfigRaw(world.name);
    if (cfg != null) await writeFile(join(worldTpl, 'world.json'), cfg, 'utf-8');

    const written: string[] = [];
    const missing: string[] = [];
    for (const docId of docIds) {
      // Defense-in-depth: only accept catalog-shaped doc ids (mirrors ENTRY_NAME_RE)
      // before composing a path. The sole caller already validates via WorldService;
      // this keeps the snapshot method self-safe against a traversal-shaped docId.
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(docId)) { missing.push(docId); continue; }
      const serialized = getDocSerialized(world.name, docId);
      if (serialized == null) { missing.push(docId); continue; }
      await writeFile(join(worldTpl, `${docId}.md`), serialized, 'utf-8');
      written.push(docId);
    }

    // Mirror the snapshot into the re-pull baseline.
    await cp(worldTpl, worldBase, { recursive: true });

    const opened = await this.open(slug);
    if (opened) {
      const m = opened.manifest;
      m.pulledFrom.world = { name: world.name, source: world.source };
      m.worldDocs = written;
      m.lastWrittenByApp = this.appVersion;
      m.history.push({ at: new Date().toISOString(), event: 'world-pull', detail: written.join(',') });
      await writeFile(join(base, 'book.json'), JSON.stringify(m, null, 2) + '\n', 'utf-8');
    }
    return { written, missing };
  }

  /**
   * World binding: unbind a book's world. Removes templates/world/ + .baseline/world/,
   * clears pulledFrom.world + worldDocs, appends a `world-unbind` history entry.
   * Schema-gated via assertWritable (mirrors snapshotWorldDocs). Returns false if no book.
   */
  async clearWorld(slug: string): Promise<boolean> {
    await this.assertWritable(slug);
    const base = this.bookDir(slug);
    if (!base) throw new Error(`Invalid slug: ${slug}`);
    await rm(join(base, 'templates', 'world'), { recursive: true, force: true });
    await rm(join(base, '.baseline', 'world'), { recursive: true, force: true });
    const opened = await this.open(slug);
    if (!opened) return false;
    const m = opened.manifest;
    if (m.pulledFrom) m.pulledFrom.world = null;
    m.worldDocs = [];
    m.lastWrittenByApp = this.appVersion;
    m.history.push({ at: new Date().toISOString(), event: 'world-unbind' });
    await writeFile(join(base, 'book.json'), JSON.stringify(m, null, 2) + '\n', 'utf-8');
    return true;
  }

  /**
   * World Repository Phase 5: save the ordered appendix selection on the book manifest.
   * Read-modify-write of books/<slug>/book.json. Entries are stored sorted by order asc.
   * Returns the updated manifest, or undefined when the slug has no readable book.
   * No schema bump (additive-optional field).
   */
  async setAppendix(
    slug: string,
    entries: Array<{ docId: string; title?: string; order: number }>,
  ): Promise<BookManifest | undefined> {
    const opened = await this.open(slug);
    if (!opened) return undefined;
    const manifest = opened.manifest;
    manifest.appendix = [...entries].sort((a, b) => a.order - b.order);
    const base = this.bookDir(slug);
    if (!base) return undefined;
    await writeFile(join(base, 'book.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
    return manifest;
  }

  /**
   * Composes a book's snapshotted sections (templates/sections/*.md) into a single
   * string for prompt injection (config-not-code pipelines, Task 11). Each .md file
   * goes under a "## Section — <name>" header (alphabetical by name); *.meta.json
   * sidecars are skipped. Reads fresh each call. Returns null when slug is
   * null/invalid, no sections snapshot exists, or no non-empty section files exist.
   */
  sectionsOf(slug: string | null): string | null {
    if (!slug) return null;
    const dir = this.bookDir(slug);
    if (!dir) return null;
    const secDir = join(dir, 'templates', 'sections');
    if (!existsSync(secDir)) return null;
    let names: string[];
    try {
      names = readdirSync(secDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.md'))
        .map((e) => e.name)
        .sort();
    } catch {
      return null;
    }
    const parts: string[] = [];
    for (const file of names) {
      let body: string;
      try { body = readFileSync(join(secDir, file), 'utf-8').trim(); } catch { continue; }
      if (!body) continue;
      parts.push(`## Section — ${file.replace(/\.md$/, '')}\n\n${body}`);
    }
    return parts.length ? parts.join('\n\n') : null;
  }

  /** The active book's composed sections block, or null (config-not-code, Task 11). */
  getActiveSections(): string | null {
    return this.sectionsOf(this.activeBookSlug);
  }

  /**
   * Return the book's SNAPSHOTTED content for one referenced skill
   * (templates/skills/<name>/SKILL.md), or null when slug is null/invalid, the
   * book has no such snapshot, or the file is unreadable (fail-soft). The caller
   * falls back to the global SkillLoader so matching stays global; only the
   * injected *content* prefers the book's frozen copy (config-not-code, Task 12).
   */
  skillContentOf(slug: string | null, name: string): string | null {
    if (!slug || !name) return null;
    const dir = this.bookDir(slug);
    if (!dir) return null;
    const p = join(dir, 'templates', 'skills', name, 'SKILL.md');
    if (!existsSync(p)) return null;
    try {
      return readFileSync(p, 'utf-8');
    } catch {
      return null;
    }
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
    // Phase 10: drop any per-channel overrides pointing at the deleted book.
    let overridesChanged = false;
    for (const [ch, s] of this.channelBooks) {
      if (s === slug) { this.channelBooks.delete(ch); overridesChanged = true; }
    }
    if (overridesChanged) await this.persistChannelBooks();
    if (this.activeBookSlug === slug) {
      this.activeBookSlug = null;
      // BUG L10: clear the persisted pointer BEFORE reseeding so the on-disk
      // active-book.json never references the just-deleted slug — if seeding then
      // fails (catch branch returns null without rewriting the pointer), no stale
      // file is left behind.
      await rm(this.activePtrPath, { force: true });
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
    // v2: the first pipeline of the snapshotted sequence. Resolve the first name
    // from the manifest's pipelineSequence; fall back to the legacy single
    // templates/pipeline.json for an un-migrated v1 book.
    const seq = this.pipelineSequenceOf(slug);
    if (seq.length) return this.snapshotPipelineOf(slug, seq[0]);
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
   * Read the manifest's pipelineSequence (ordered names) for a slug, or [] when
   * the book is unknown/unreadable or has no sequence (v1, pre-migration).
   */
  private pipelineSequenceOf(slug: string | null): string[] {
    if (!slug) return [];
    const d = this.bookDir(slug);
    if (!d) return [];
    const mf = join(d, 'book.json');
    if (!existsSync(mf)) return [];
    try {
      const m = JSON.parse(readFileSync(mf, 'utf-8')) as BookManifest;
      return Array.isArray(m.pipelineSequence) ? m.pipelineSequence : [];
    } catch {
      return [];
    }
  }

  /** The book's current lifecycle phase from the manifest, or undefined. */
  private phaseOf(slug: string | null): string | undefined {
    if (!slug) return undefined;
    const d = this.bookDir(slug);
    if (!d) return undefined;
    const mf = join(d, 'book.json');
    if (!existsSync(mf)) return undefined;
    try {
      const m = JSON.parse(readFileSync(mf, 'utf-8')) as BookManifest;
      return typeof m.phase === 'string' ? m.phase : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Parse and return one snapshotted sequence pipeline (templates/pipeline/<name>.json
   * → LibraryPipeline shape). Null if slug is null/invalid, no book exists, or the
   * file is missing/corrupt (fail-soft — caller decides). Mirrors pipelineOf.
   */
  snapshotPipelineOf(slug: string | null, name: string): import('./library-types.js').LibraryPipeline | null {
    if (!slug || !name) return null;
    const d = this.bookDir(slug);
    if (!d) return null;
    const p = join(d, 'templates', 'pipeline', `${name}.json`);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf-8'));
    } catch (err) {
      console.warn(`  ⚠ Books: could not parse pipeline/${name}.json for "${slug}" — ${(err as Error)?.message || err}`);
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

  /**
   * Overwrite a book's author/voice/genre[/pipeline] snapshot from a series' refs
   * (Series Phase A "pull series assets into book"). Re-snapshots both templates/
   * and .baseline/ (so a later library re-pull diffs against the new asset) and
   * updates the manifest pulledFrom names. Gated by assertWritable; a ref absent
   * from the library is skipped fail-soft.
   */
  async applySeriesAssets(
    slug: string,
    refs: { author?: PulledRef | null; voice?: PulledRef | null; genre?: PulledRef | null; pipeline?: PulledRef | null },
    worldbuilding?: { characters?: string; places?: string; lore?: string },
  ): Promise<void> {
    await this.assertWritable(slug);
    const dir = this.bookDir(slug);
    if (!dir) return;
    const opened = await this.open(slug);
    if (!opened) return;
    const m = opened.manifest;
    const applied: string[] = [];
    for (const kind of ['author', 'voice', 'genre', 'pipeline'] as const) {
      const ref = refs[kind];
      if (!ref || !ref.name) continue;
      const files = this.libraryFiles(kind, ref.name);
      if (!files) { console.warn(`  ⚠ Series pull: ${kind}/${ref.name} not in library — skipping`); continue; }
      for (const root of ['templates', '.baseline'] as const) {
        const rel = this.assetRel(kind, ref.name);
        const target = rel ? join(dir, root, rel) : join(dir, root);
        // pipeline shares one dir across a book's whole sequence; rm'ing it would
        // wipe the other sequence pipelines. Mirror repull's writeMap: mkdir +
        // overwrite only the single <name>.json (done in the writeFile below).
        if (rel && kind !== 'pipeline') { try { await rm(target, { recursive: true, force: true }); } catch { /* fresh */ } }
        await mkdir(target, { recursive: true });
        for (const [libName, content] of Object.entries(files)) {
          await writeFile(join(target, this.assetFileName(kind, libName, ref.name)), content, 'utf-8');
        }
        // libraryFiles returns only .md content; the rm above wiped the description
        // meta.json sidecar createBook/writeTemplate persist. Restore it so the
        // author/voice/genre description isn't silently dropped by a series pull.
        if (kind === 'author' || kind === 'voice' || kind === 'genre') {
          const desc = this.library.get(kind, ref.name)?.description;
          if (typeof desc === 'string') {
            await writeFile(join(target, 'meta.json'), JSON.stringify({ description: desc }), 'utf-8');
          }
        }
      }
      const version = kind === 'pipeline' ? this.library.get('pipeline', ref.name)?.pipeline?.schemaVersion : undefined;
      const newRef: PulledRef = { name: ref.name, source: ref.source, ...(version != null ? { version } : {}) };
      if (kind === 'author') m.pulledFrom.author = newRef;
      else if (kind === 'voice') m.pulledFrom.voice = newRef;
      else if (kind === 'genre') m.pulledFrom.genre = newRef;
      else if (kind === 'pipeline') m.pulledFrom.pipeline = newRef;
      applied.push(`${kind}/${ref.name}`);
    }
    // Series Phase B: resync world-building (rm+rewrite templates/ + .baseline/).
    if (worldbuilding) {
      const entries = (['characters', 'places', 'lore'] as const).filter((k) => typeof worldbuilding[k] === 'string' && worldbuilding[k]!.length > 0);
      for (const root of ['templates', '.baseline'] as const) {
        const wbDir = join(dir, root, 'worldbuilding');
        try { await rm(wbDir, { recursive: true, force: true }); } catch { /* fresh */ }
        if (entries.length) {
          await mkdir(wbDir, { recursive: true });
          for (const k of entries) await writeFile(join(wbDir, `${k}.md`), worldbuilding[k]!, 'utf-8');
        }
      }
      if (entries.length) applied.push('worldbuilding');   // history reflects real content, not empty resyncs
    }
    m.lastWrittenByApp = this.appVersion;
    m.history.push({ at: new Date().toISOString(), event: 'series-pull', detail: applied.join(',') });
    await writeFile(join(dir, 'book.json'), JSON.stringify(m, null, 2) + '\n', 'utf-8');
  }

  /**
   * The book's ordered, distinct pipeline phases — the segments the board
   * renders (TODO #15). Derived from the snapshotted templates/pipeline.json;
   * returns [] when no pipeline resolves so the UI falls back to LIFECYCLE_PHASES.
   */
  phasesForBook(slug: string | null): string[] {
    const seq = this.pipelineSequenceOf(slug);
    if (seq.length) {
      const phases: string[] = [];
      for (const name of seq) {
        // Prefer the canonical lifecycle phase for a known pipeline so the board
        // segments match the manifest-phase vocabulary (planning/bible/production/
        // revision/format/launch) — otherwise production's step sub-phases
        // (writing/polish/assembly) leak in and `production` isn't a segment, so
        // the drawer can't place the book. Custom pipelines fall back to their
        // step-derived phases.
        const canonical = PROJECT_TYPE_PHASE[name];
        let derived: string[];
        if (canonical) {
          derived = [canonical];
        } else {
          const p = this.snapshotPipelineOf(slug, name);
          derived = p ? pipelinePhases(p) : [];
        }
        for (const ph of derived) {
          if (phases[phases.length - 1] !== ph) phases.push(ph); // dedup adjacent-equal only
        }
      }
      return phases;
    }
    // Fall back to the single-pipeline behavior (un-migrated v1 / no sequence).
    const p = this.pipelineOf(slug);
    return p ? pipelinePhases(p) : [];
  }

  /**
   * Persist the book's current pipeline phase to book.json (TODO #15 — the
   * missing post-create writer of `phase`). Fail-soft: a no-op for an unknown
   * book or unreadable manifest. Skips the write when the phase is unchanged.
   */
  async setPhase(slug: string, phase: string): Promise<void> {
    const dir = this.bookDir(slug);
    if (!dir || !existsSync(join(dir, 'book.json'))) return;
    await this.assertWritable(slug); // schemaVersion gate (mirrors writeTemplate/repull)
    let m: BookManifest;
    try {
      m = JSON.parse(readFileSync(join(dir, 'book.json'), 'utf-8'));
    } catch {
      return; // corrupt manifest — don't clobber it
    }
    if (m.phase === phase) return;
    m.phase = phase;
    m.lastWrittenByApp = this.appVersion;
    m.history.push({ at: new Date().toISOString(), event: 'phase', detail: phase });
    await writeFile(join(dir, 'book.json'), JSON.stringify(m, null, 2) + '\n', 'utf-8');
  }

  // ── Phase 4: per-asset re-pull from the library ────────────────────────────

  /** The library's current files/content for an asset, normalised to a file map. */
  private libraryFiles(kind: RepullAsset['kind'], name: string, worldName?: string | null): Record<string, string> | null {
    // World docs live in WorldService (not the library overlay): the asset `name`
    // is the docId, resolved against the book's bound world. Fail-soft to null
    // (→ `library-removed`) when the world service or world name is absent.
    if (kind === 'world') {
      if (!this.worldService || !worldName) return null;
      const doc = this.worldService.getDocument(worldName, name);
      if (!doc) return null;
      return { [`${name}.md`]: serializeWorldDoc(doc.meta, doc.body) };
    }
    const e = this.library.get(kind, name);
    if (!e) return null;
    if (e.files) return e.files;
    if (kind === 'pipeline' && e.pipeline) return { [`${name}.json`]: JSON.stringify(e.pipeline, null, 2) + '\n' };
    if (typeof e.content === 'string') return { [kind === 'section' ? `${name}.md` : 'SKILL.md']: e.content };
    return null;
  }

  /** Synchronously read the book's bound world name from book.json, or null. */
  private boundWorldName(slug: string): string | null {
    const base = this.bookDir(slug);
    if (!base) return null;
    try {
      const m = JSON.parse(readFileSync(join(base, 'book.json'), 'utf-8')) as BookManifest;
      return m.pulledFrom?.world?.name ?? null;
    } catch { return null; }
  }

  /** templates/ (or .baseline/) relative dir for an asset's files. */
  private assetRel(kind: RepullAsset['kind'], name: string): string {
    if (kind === 'pipeline') return 'pipeline';    // v2: file lives at <root>/pipeline/<name>.json
    if (kind === 'section') return 'sections';
    if (kind === 'world') return 'world';          // file lives at <root>/world/<docId>.md
    if (kind === 'skill') return join('skills', name);
    return kind;                                   // author/voice/genre dir
  }

  /** Map a library file name to its on-disk name under templates/. */
  private assetFileName(kind: RepullAsset['kind'], libFileName: string, name: string): string {
    if (kind === 'pipeline') return `${name}.json`; // v2: per-name file
    if (kind === 'section') return `${name}.md`;
    if (kind === 'world') return `${name}.md`;      // world doc: <docId>.md
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
      const p = join(base, root, 'pipeline', `${name}.json`);
      return existsSync(p) ? { [`${name}.json`]: readFileSync(p, 'utf-8') } : null;
    }
    if (kind === 'section') {
      const p = join(base, root, 'sections', `${name}.md`);
      return existsSync(p) ? { [`${name}.md`]: readFileSync(p, 'utf-8') } : null;
    }
    if (kind === 'world') {
      const p = join(base, root, 'world', `${name}.md`);
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
    for (const id of opened.manifest.worldDocs || []) out.push({ kind: 'world', name: id });
    return out;
  }

  /** Per-asset re-pull status for a book. */
  async repullStatus(slug: string): Promise<RepullAsset[]> {
    const assets = await this.assetsOf(slug);
    const worldName = this.boundWorldName(slug);
    return assets.map(({ kind, name }) => {
      const lib = this.libraryFiles(kind, name, worldName);
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
   * Enforce the schemaVersion gate on a per-book WRITE path. Throws when the
   * book's classified status is not `ok` (a too-old book is `quarantined`, a
   * too-new one `readonly`) so we never rewrite a book in an incompatible app's
   * shape. As of the 2026-06-14 v1→v2 bump (SCHEMA=2, MIN=1) a `readonly` book
   * (written by a newer app, schemaVersion > 2) is reachable, so this gate is now
   * load-bearing on writes (incl. setPhase). See classifyVersion in book-types.ts.
   */
  private async assertWritable(slug: string): Promise<void> {
    const opened = await this.open(slug);
    if (opened && opened.status !== 'ok') {
      throw new Error(`book ${slug} is ${opened.status}; refusing to write`);
    }
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
    await this.assertWritable(slug); // schemaVersion gate (no-op today; see assertWritable)
    const lib = this.libraryFiles(kind, name, this.boundWorldName(slug));
    if (!lib) throw new Error(`Library no longer has ${kind}/${name}`);
    const baseline = this.readAssetFrom(slug, '.baseline', kind, name);
    const book = this.readAssetFrom(slug, 'templates', kind, name);

    const writeMap = async (root: 'templates' | '.baseline', files: Record<string, string>) => {
      const rel = this.assetRel(kind, name);
      const dir = join(base, root, rel);
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
      // Library-side removal (file known to baseline/book but absent from the
      // library now). Feeding t='' to diff3 auto-resolves to a silent deletion
      // with hadConflicts:false — a clean book would lose e.g. PERSONALITY.md on
      // re-pull. Treat it as a conflict: KEEP the book's content (or the baseline
      // if the book lacks it) and flag the conflict so the caller surfaces it.
      if (!(f in lib)) {
        const kept = m || b;
        if (kept) { mergedFiles[f] = kept; hadConflicts = true; }
        continue;
      }
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
      // v2 layout: templates/pipeline/<name>.json. Resolve the name from the
      // caller; else the pipeline matching the book's CURRENT phase (so the Write
      // view shows the active phase's plan, e.g. book-bible once Planning is done,
      // not always the first/completed pipeline); else the first sequence entry.
      const seq = this.pipelineSequenceOf(slug);
      const pname = name || pipelineNameForPhase(this.phaseOf(slug), seq) || seq[0];
      if (!pname) return null;
      const p = join(tdir, 'pipeline', `${pname}.json`);
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
    await this.assertWritable(slug); // schemaVersion gate (no-op today; see assertWritable)
    // World docs are snapshotted via snapshotWorldDocs (which mirrors .baseline/world/
    // for the 3-way re-pull). Routing them through the generic template writer would
    // skip that baseline discipline and desync re-pull — reject explicitly so adding
    // 'world' to TEMPLATE_KINDS can never silently open that bypass.
    if (kind === 'world') throw new Error('invalid: world docs are managed via snapshotWorldDocs, not writeTemplate');
    const wired = WIRED_KINDS.has(kind);
    if (kind === 'pipeline') {
      const raw = String(body.content ?? '');
      parsePipelineJson(raw); // throws 'pipeline content must be...' on bad input
      // v2 layout: templates/pipeline/<name>.json. Resolve the name from the
      // caller, else the first sequence pipeline (back-compat single-pipeline edit).
      const pname = name || this.pipelineSequenceOf(slug)[0] || 'pipeline';
      await mkdir(join(tdir, 'pipeline'), { recursive: true });
      await writeFile(join(tdir, 'pipeline', `${pname}.json`), raw.endsWith('\n') ? raw : raw + '\n', 'utf-8');
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
    else if (kind === 'world') {
      // The asset `name` here is the docId; the per-doc identity stays in
      // worldDocs. Refresh pulledFrom.world (the bound world) by NAME, preserving
      // its source — the docId never becomes the world ref name.
      const wname = m.pulledFrom.world?.name;
      if (wname) {
        const wsource: PulledRef['source'] = this.library.get('world', wname)?.source ?? m.pulledFrom.world?.source ?? 'workspace';
        m.pulledFrom.world = { name: wname, source: wsource };
      }
    }
    m.lastWrittenByApp = this.appVersion;
    m.history.push({ at: new Date().toISOString(), event: 'repull', detail: `${kind}/${name}` });
    const dir = this.bookDir(slug);
    if (dir) await writeFile(join(dir, 'book.json'), JSON.stringify(m, null, 2) + '\n', 'utf-8');
  }
}
