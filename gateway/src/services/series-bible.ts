/**
 * BookClaw Series Bible
 *
 * Cross-project memory for authors running multi-book series. Merges entity
 * indexes from every member project's ContextEngine into one canonical
 * series view, with alias-based deduplication, per-book delta tracking, and
 * contradiction detection across the whole universe.
 *
 * Complements (doesn't replace) the single-book ContextEngine: individual
 * projects still own their per-chapter summaries and entities; the Series
 * Bible unifies them when you're writing book 7 and need to remember a
 * background character's eye color from book 2.
 */

import { readFile, writeFile, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { EntityEntry, ContextEngine } from './context-engine.js';

// ═══════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════

export interface SeriesEntity extends EntityEntry {
  firstBook: string;            // projectId where entity first appeared
  appearances: string[];        // projectIds the entity shows up in
  canonicalAttributes: Record<string, string>;  // reconciled across books
  bookDeltas: Array<{           // notable changes per book
    projectId: string;
    change: string;
  }>;
}

export interface TimelineEvent {
  projectId: string;
  chapterId: string;
  chapterNumber: number;
  bookTitle: string;
  timelineMarker: string;       // "Day 3, dawn" / "Two weeks later"
  endingState: string;
}

export interface SeriesContradiction {
  category: 'attribute' | 'timeline' | 'plot' | 'location';
  severity: 'warning' | 'error';
  entity?: string;
  description: string;
  books: string[];              // projectIds involved
  suggestion: string;
}

/** A library asset the series shares with its books (mirrors PulledRef). */
export interface SeriesRef {
  name: string;
  source: 'builtin' | 'workspace' | 'synthetic';
}

export interface Series {
  id: string;
  title: string;
  description: string;
  // Shared library assets books inherit at create-time (Series Phase A).
  pulledFrom: {
    author?: SeriesRef;
    voice?: SeriesRef;
    genre?: SeriesRef | null;
    pipeline?: SeriesRef | null;
  };
  bookSlugs: string[];          // member books (book-centric membership)
  readingOrder: string[];       // member book slugs in intended reading order
  projectIds?: string[];        // legacy (pre-Phase-A) — kept for report back-compat
  createdAt: string;
  updatedAt: string;
}

export interface SeriesBibleReport {
  series: Series;
  entities: SeriesEntity[];
  timeline: TimelineEvent[];
  contradictions: SeriesContradiction[];
  stats: {
    totalBooks: number;
    totalWords: number;
    totalChapters: number;
    characterCount: number;
    locationCount: number;
  };
}

/** One asset where a book's snapshot name differs from the series' current ref. */
export interface SeriesDivergence {
  kind: 'author' | 'voice' | 'genre' | 'pipeline';
  series: string;   // the series' ref name
  book: string;     // the book's snapshot name ('' if absent)
}

/**
 * Compare a book's snapshot refs to the series' refs by NAME. Kinds the series
 * doesn't set (absent or null) are ignored. Pure (Series Phase A).
 */
export function seriesDivergence(
  refs: Series['pulledFrom'],
  book: { author?: { name: string }; voice?: { name: string }; genre?: { name: string } | null; pipeline?: { name: string } | null },
): SeriesDivergence[] {
  const out: SeriesDivergence[] = [];
  for (const kind of ['author', 'voice', 'genre', 'pipeline'] as const) {
    const ref = refs[kind];
    if (!ref || !ref.name) continue;             // series doesn't set this kind
    const bookName = book[kind]?.name ?? '';
    if (bookName !== ref.name) out.push({ kind, series: ref.name, book: bookName });
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════

export class SeriesBibleService {
  private series: Map<string, Series> = new Map();
  private seriesRoot: string;   // workspace/series
  private legacyFlat: string;   // workspace/series.json (pre-Phase-A)

  constructor(workspaceDir: string) {
    this.seriesRoot = join(workspaceDir, 'series');
    this.legacyFlat = join(workspaceDir, 'series.json');
  }

  private seriesDir(id: string): string { return join(this.seriesRoot, id); }

  /** Fill defaults + self-correct a stored/legacy series into the Phase-A shape. */
  private normalize(s: any): Series {
    const bookSlugs: string[] = Array.isArray(s?.bookSlugs) ? s.bookSlugs : [];
    const now = new Date().toISOString();
    return {
      id: String(s.id),
      title: s?.title || '',
      description: s?.description || '',
      pulledFrom: s?.pulledFrom && typeof s.pulledFrom === 'object' ? s.pulledFrom : {},
      bookSlugs,
      // readingOrder is book-centric now: keep only entries that are member books
      // (a migrated legacy series has project-id readingOrder + no books → []).
      readingOrder: (Array.isArray(s?.readingOrder) ? s.readingOrder : []).filter((x: string) => bookSlugs.includes(x)),
      ...(Array.isArray(s?.projectIds) ? { projectIds: s.projectIds } : {}),
      createdAt: s?.createdAt || now,
      updatedAt: s?.updatedAt || s?.createdAt || now,
    };
  }

  async initialize(): Promise<void> {
    // Fail-soft (CLAUDE.md): a series-store problem must never crash boot — degrade
    // to no series rather than throwing out of the awaited init chain.
    try {
      await mkdir(this.seriesRoot, { recursive: true });
      await this.migrateFlat();
      const { readdir } = await import('fs/promises');
      for (const entry of await readdir(this.seriesRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const mf = join(this.seriesDir(entry.name), 'series.json');
        if (!existsSync(mf)) continue;
        try {
          const s = JSON.parse(await readFile(mf, 'utf-8'));
          if (s?.id) this.series.set(s.id, this.normalize(s));
        } catch { /* skip one corrupt series */ }
      }
    } catch (err) {
      console.warn('  ⚠ Series: initialize failed — continuing with no series', err);
    }
  }

  /** One-time fail-soft migration of the flat workspace/series.json into per-dir manifests. */
  private async migrateFlat(): Promise<void> {
    if (!existsSync(this.legacyFlat)) return;
    try {
      const parsed = JSON.parse(await readFile(this.legacyFlat, 'utf-8'));
      const arr = Array.isArray(parsed.series) ? parsed.series : [];
      for (const s of arr) {
        if (!s?.id) continue;
        // Idempotent across a partial-failure window: never overwrite an
        // already-migrated (possibly since-edited) per-dir manifest.
        if (existsSync(join(this.seriesDir(s.id), 'series.json'))) continue;
        await this.persist(this.normalize(s));
      }
    } catch { /* corrupt legacy file — drop it, start clean */ }
    try {
      const { rename } = await import('fs/promises');
      await rename(this.legacyFlat, this.legacyFlat + '.migrated');
    } catch { /* best-effort */ }
  }

  // ── CRUD ──

  async createSeries(input: {
    title: string;
    description?: string;
    refs?: Series['pulledFrom'];
    projectIds?: string[];      // legacy input tolerated; not used by Phase-A callers
  }): Promise<Series> {
    const id = `series-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const series: Series = {
      id,
      title: input.title,
      description: input.description || '',
      pulledFrom: input.refs || {},
      bookSlugs: [],
      readingOrder: [],
      ...(input.projectIds ? { projectIds: input.projectIds } : {}),
      createdAt: now,
      updatedAt: now,
    };
    this.series.set(id, series);
    await this.persist(series);
    return series;
  }

  /** Patch a series' title/description (Series Phase C edit). */
  async update(seriesId: string, patch: { title?: string; description?: string }): Promise<Series | null> {
    const series = this.series.get(seriesId);
    if (!series) return null;
    if (typeof patch.title === 'string' && patch.title.trim()) series.title = patch.title.trim();
    if (typeof patch.description === 'string') series.description = patch.description;
    series.updatedAt = new Date().toISOString();
    await this.persist(series);
    return series;
  }

  /** Set the shared library asset refs books inherit at create-time (Phase A). */
  async setRefs(seriesId: string, refs: Partial<Series['pulledFrom']>): Promise<Series | null> {
    const series = this.series.get(seriesId);
    if (!series) return null;
    series.pulledFrom = { ...series.pulledFrom, ...refs };
    series.updatedAt = new Date().toISOString();
    await this.persist(series);
    return series;
  }

  /** Add a member book (idempotent) → membership + reading order. */
  async addBook(seriesId: string, slug: string): Promise<Series | null> {
    const series = this.series.get(seriesId);
    if (!series) return null;
    if (!series.bookSlugs.includes(slug)) {
      series.bookSlugs.push(slug);
      if (!series.readingOrder.includes(slug)) series.readingOrder.push(slug);
      series.updatedAt = new Date().toISOString();
      await this.persist(series);
    }
    return series;
  }

  /** Remove a member book from membership + reading order. */
  async removeBook(seriesId: string, slug: string): Promise<Series | null> {
    const series = this.series.get(seriesId);
    if (!series) return null;
    if (!series.bookSlugs.includes(slug)) return series;   // no-op: don't churn updatedAt/disk
    series.bookSlugs = series.bookSlugs.filter(s => s !== slug);
    series.readingOrder = series.readingOrder.filter(s => s !== slug);
    series.updatedAt = new Date().toISOString();
    await this.persist(series);
    return series;
  }

  /** Set the reading order; keeps only member-book slugs. */
  async setReadingOrder(seriesId: string, order: string[]): Promise<Series | null> {
    const series = this.series.get(seriesId);
    if (!series) return null;
    series.readingOrder = order.filter(slug => series.bookSlugs.includes(slug));
    series.updatedAt = new Date().toISOString();
    await this.persist(series);
    return series;
  }

  // ── World-building (Series Phase B): characters/places/lore.md under the series dir ──

  private worldbuildingDir(id: string): string { return join(this.seriesDir(id), 'worldbuilding'); }

  /** Read the series' world-building files; absent files read as ''. */
  async getWorldbuilding(id: string): Promise<{ characters: string; places: string; lore: string }> {
    const dir = this.worldbuildingDir(id);
    const out = { characters: '', places: '', lore: '' };
    for (const k of ['characters', 'places', 'lore'] as const) {
      const p = join(dir, `${k}.md`);
      if (existsSync(p)) { try { out[k] = await readFile(p, 'utf-8'); } catch { /* leave '' */ } }
    }
    return out;
  }

  /**
   * Write the provided world-building files (undefined keys are left untouched).
   * An empty/whitespace-only value CLEARS that file (delete) so only non-empty
   * files persist on disk — matching the spec + the book-side compose semantics.
   */
  async setWorldbuilding(id: string, files: { characters?: string; places?: string; lore?: string }): Promise<void> {
    const dir = this.worldbuildingDir(id);
    await mkdir(dir, { recursive: true });
    const { rename } = await import('fs/promises');
    for (const k of ['characters', 'places', 'lore'] as const) {
      const v = files[k];
      if (typeof v !== 'string') continue;            // omitted → leave as-is
      const dest = join(dir, `${k}.md`);
      if (v.trim() === '') { try { await rm(dest, { force: true }); } catch { /* already gone */ } continue; }
      const tmp = join(dir, `${k}.md.tmp`);
      await writeFile(tmp, v);
      await rename(tmp, dest);
    }
  }

  getSeries(seriesId: string): Series | undefined {
    return this.series.get(seriesId);
  }

  listSeries(): Series[] {
    return Array.from(this.series.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async deleteSeries(seriesId: string): Promise<boolean> {
    const existed = this.series.delete(seriesId);
    if (existed) {
      try {
        const { rm } = await import('fs/promises');
        await rm(this.seriesDir(seriesId), { recursive: true, force: true });
      } catch { /* best-effort */ }
    }
    return existed;
  }

  /**
   * Build the unified bible by pulling every project's ContextEngine data
   * and merging entities + timeline. Does NOT mutate the individual project
   * contexts — this is a read-only view.
   */
  async buildReport(
    seriesId: string,
    contextEngine: ContextEngine,
    projectTitleResolver: (projectId: string) => string | undefined,
    projectsForBook?: (slug: string) => string[],
  ): Promise<SeriesBibleReport | null> {
    const series = this.series.get(seriesId);
    if (!series) return null;

    const mergedEntities = new Map<string, SeriesEntity>();
    const timeline: TimelineEvent[] = [];
    const contradictions: SeriesContradiction[] = [];
    let totalWords = 0;
    let totalChapters = 0;

    // Book-centric (Phase A): resolve member books (in reading order) → their bound
    // project ids. Fall back to a migrated series' legacy projectIds when present.
    const bookOrder = series.readingOrder.length > 0 ? series.readingOrder : series.bookSlugs;
    const orderedProjectIds: string[] = [];
    if (projectsForBook) {
      for (const slug of bookOrder) orderedProjectIds.push(...projectsForBook(slug));
    }
    if (orderedProjectIds.length === 0 && series.projectIds?.length) {
      orderedProjectIds.push(...series.projectIds);
    }

    for (const projectId of orderedProjectIds) {
      const bookTitle = projectTitleResolver(projectId) || projectId;
      let ctx;
      try {
        ctx = await contextEngine.loadContext(projectId);
      } catch {
        continue;
      }
      if (!ctx) continue;

      // Timeline events
      for (const summary of ctx.summaries) {
        timeline.push({
          projectId,
          chapterId: summary.chapterId,
          chapterNumber: summary.chapterNumber,
          bookTitle,
          timelineMarker: summary.timelineMarker || '',
          endingState: summary.endingState || '',
        });
        totalWords += summary.wordCount || 0;
        totalChapters++;
      }

      // Merge entities (alias-aware).
      for (const entity of ctx.entities) {
        const key = this.entityKey(entity);
        const existing = mergedEntities.get(key);
        if (existing) {
          // Same entity already seen in earlier book — merge.
          this.mergeEntity(existing, entity, projectId, contradictions, bookTitle);
        } else {
          // New entity — seed it.
          mergedEntities.set(key, {
            ...entity,
            firstBook: projectId,
            appearances: [projectId],
            canonicalAttributes: { ...entity.attributes },
            bookDeltas: (entity.changes || []).map(c => ({
              projectId,
              change: c.description,
            })),
          });
        }
      }
    }

    // Timeline ordering sanity check.
    this.checkTimelineMonotonic(timeline, contradictions);

    const entities = Array.from(mergedEntities.values());
    const characterCount = entities.filter(e => e.type === 'character').length;
    const locationCount = entities.filter(e => e.type === 'location').length;

    return {
      series,
      entities,
      timeline,
      contradictions,
      stats: {
        totalBooks: orderedProjectIds.length,
        totalWords,
        totalChapters,
        characterCount,
        locationCount,
      },
    };
  }

  /** Key used to merge entities across books — canonical name lowercase. */
  private entityKey(entity: EntityEntry): string {
    return (entity.name || '').toLowerCase().trim();
  }

  /** Merge a new entity into an existing canonical entry. */
  private mergeEntity(
    canonical: SeriesEntity,
    incoming: EntityEntry,
    projectId: string,
    contradictions: SeriesContradiction[],
    bookTitle: string,
  ): void {
    if (!canonical.appearances.includes(projectId)) {
      canonical.appearances.push(projectId);
    }

    // Merge aliases
    for (const alias of incoming.aliases || []) {
      if (!canonical.aliases.some(a => a.toLowerCase() === alias.toLowerCase())) {
        canonical.aliases.push(alias);
      }
    }

    // Check attribute contradictions and merge.
    for (const [key, value] of Object.entries(incoming.attributes || {})) {
      const canonicalValue = canonical.canonicalAttributes[key];
      if (canonicalValue && canonicalValue.toLowerCase().trim() !== value.toLowerCase().trim()) {
        // Soft-contradiction: flag it, but accept the newer value as a delta.
        contradictions.push({
          category: 'attribute',
          severity: 'warning',
          entity: canonical.name,
          description: `"${canonical.name}"'s ${key}: "${canonicalValue}" (earlier) vs "${value}" (${bookTitle}).`,
          books: [canonical.firstBook, projectId],
          suggestion: `Decide which book is canon for this attribute, or add a timeline event explaining the change.`,
        });
        canonical.bookDeltas.push({
          projectId,
          change: `${key} changed from "${canonicalValue}" to "${value}"`,
        });
      }
      canonical.canonicalAttributes[key] = value;
    }

    // Prefer the longest description.
    if (incoming.description && incoming.description.length > canonical.description.length) {
      canonical.description = incoming.description;
    }
  }

  /** Check that timeline markers in the same chapter don't jump backwards illogically. */
  private checkTimelineMonotonic(timeline: TimelineEvent[], contradictions: SeriesContradiction[]): void {
    // Extract weak ordering signals from timeline markers (days, weeks, years).
    const withDay = timeline
      .map((ev, idx) => ({ ev, idx, day: this.extractDay(ev.timelineMarker) }))
      .filter(t => t.day !== null);

    for (let i = 1; i < withDay.length; i++) {
      const prev = withDay[i - 1];
      const curr = withDay[i];
      // Only flag if in the same book to avoid cross-book time jumps.
      if (prev.ev.projectId !== curr.ev.projectId) continue;
      if ((curr.day! < prev.day!) && (prev.ev.chapterNumber < curr.ev.chapterNumber)) {
        contradictions.push({
          category: 'timeline',
          severity: 'warning',
          description: `Timeline moves backward: Ch ${prev.ev.chapterNumber} says "${prev.ev.timelineMarker}" but Ch ${curr.ev.chapterNumber} says "${curr.ev.timelineMarker}".`,
          books: [curr.ev.projectId],
          suggestion: `Review chapter order or clarify the timeline markers.`,
        });
      }
    }
  }

  /** Very rough day-number extractor from a timeline marker string. */
  private extractDay(marker: string): number | null {
    if (!marker) return null;
    const dayMatch = marker.match(/day\s+(\d+)/i);
    if (dayMatch) return parseInt(dayMatch[1], 10);
    const weekMatch = marker.match(/week\s+(\d+)/i);
    if (weekMatch) return parseInt(weekMatch[1], 10) * 7;
    const monthMatch = marker.match(/month\s+(\d+)/i);
    if (monthMatch) return parseInt(monthMatch[1], 10) * 30;
    return null;
  }

  // ── Persistence ──

  private async persist(series: Series): Promise<void> {
    try {
      const dir = this.seriesDir(series.id);
      await mkdir(dir, { recursive: true });
      const tmp = join(dir, 'series.json.tmp');
      await writeFile(tmp, JSON.stringify(series, null, 2));
      const { rename } = await import('fs/promises');
      await rename(tmp, join(dir, 'series.json'));
    } catch (err) {
      console.error('  ✗ Failed to persist series:', err);
    }
  }
}
