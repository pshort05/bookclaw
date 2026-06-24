import { join, dirname } from 'path';
import type { LedgerFact, KnowledgeEvent } from './types.js';

export class ConsistencyStore {
  private db: any = null;                 // better-sqlite3, lazy `any`
  private dbPath: string;
  private unavailableReason: string | null = null;

  constructor(workspaceDir: string, dbDir?: string) {
    this.dbPath = dbDir ? join(dbDir, 'consistency.db') : join(workspaceDir, 'memory', 'consistency.db');
  }
  getDbPath(): string { return this.dbPath; }

  async initialize(): Promise<void> {
    try {
      // @ts-ignore — optional native dep, lazy-loaded as any.
      const mod: any = await import('better-sqlite3');
      const Database: any = mod.default || mod;
      const { mkdir } = await import('fs/promises');
      await mkdir(dirname(this.dbPath), { recursive: true });
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS facts (
          id INTEGER PRIMARY KEY,
          world TEXT, book_slug TEXT,
          entity TEXT NOT NULL, aliases TEXT NOT NULL, attribute TEXT NOT NULL,
          type TEXT NOT NULL, value_raw TEXT NOT NULL, value_norm TEXT NOT NULL,
          story_time INTEGER NOT NULL, time_label TEXT, transition TEXT,
          chapter TEXT NOT NULL, scene INTEGER NOT NULL,
          source TEXT NOT NULL, evidence TEXT NOT NULL,
          canonical INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_facts_lookup ON facts (world, book_slug, entity, attribute);
        CREATE INDEX IF NOT EXISTS idx_facts_book ON facts (book_slug, chapter);
        CREATE TABLE IF NOT EXISTS knowledge (
          id INTEGER PRIMARY KEY,
          world TEXT, book_slug TEXT,
          knower TEXT NOT NULL, fact_key TEXT NOT NULL,
          kind TEXT NOT NULL, source TEXT NOT NULL,
          story_time INTEGER NOT NULL, chapter TEXT NOT NULL, scene INTEGER NOT NULL,
          canonical INTEGER NOT NULL DEFAULT 1, evidence TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_lookup ON knowledge (world, book_slug, knower, fact_key);
        CREATE TABLE IF NOT EXISTS canon_seed (world TEXT PRIMARY KEY, hash TEXT NOT NULL, seeded_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit_reports (book_slug TEXT PRIMARY KEY, report TEXT NOT NULL, updated_at TEXT NOT NULL);
      `);
    } catch (err: any) {
      this.unavailableReason = `better-sqlite3 unavailable: ${err?.message || err}. Consistency auditor disabled.`;
      console.warn(`  ⚠ ${this.unavailableReason}`);
      this.db = null;
    }
  }
  isAvailable(): boolean { return this.db !== null; }

  insertFacts(facts: LedgerFact[]): void {
    if (!this.db || facts.length === 0) return;
    const stmt = this.db.prepare(`INSERT INTO facts
      (world, book_slug, entity, aliases, attribute, type, value_raw, value_norm, story_time, time_label, transition, chapter, scene, source, evidence, canonical)
      VALUES (@world,@bookSlug,@entity,@aliases,@attribute,@type,@valueRaw,@valueNorm,@storyTime,@timeLabel,@transition,@chapter,@scene,@source,@evidence,@canonical)`);
    const tx = this.db.transaction((rows: LedgerFact[]) => {
      for (const f of rows) stmt.run({ ...f, aliases: JSON.stringify(f.aliases), canonical: f.canonical ? 1 : 0 });
    });
    tx(facts);
  }

  priorFacts(scope: { world: string | null; bookSlug: string }, entity: string, attribute: string): LedgerFact[] {
    if (!this.db) return [];
    const rows = this.db.prepare(`SELECT * FROM facts
      WHERE entity = ? AND attribute = ? AND canonical = 1
        AND ( book_slug = ? OR (source = 'canon' AND world IS ? ) )
      ORDER BY story_time DESC, id DESC`).all(entity, attribute, scope.bookSlug, scope.world);
    return rows.map((r: any) => ({
      world: r.world, bookSlug: r.book_slug, entity: r.entity, aliases: JSON.parse(r.aliases),
      attribute: r.attribute, type: r.type, valueRaw: r.value_raw, valueNorm: r.value_norm,
      storyTime: r.story_time, timeLabel: r.time_label, transition: r.transition,
      chapter: r.chapter, scene: r.scene, source: r.source, evidence: r.evidence,
      canonical: r.canonical !== 0,
    }));
  }

  /**
   * Reverse index (Worldfall "edit a fact → revisit these chapters"): for each
   * (entity, attribute) the book's manuscript dramatizes, the sorted distinct
   * chapters that assert it, flagged `isCanon` when a canon/bible fact backs that
   * (entity, attribute) — i.e. the editable facts whose change ripples here.
   * Sorted most-referenced first. Deterministic; no AI.
   */
  reverseIndex(scope: { world: string | null; bookSlug: string }): Array<{ entity: string; attribute: string; chapters: string[]; isCanon: boolean }> {
    if (!this.db) return [];
    const rows = this.db.prepare(
      `SELECT entity, attribute, chapter FROM facts
       WHERE book_slug = ? AND source = 'manuscript' AND canonical = 1`,
    ).all(scope.bookSlug);
    // Canon (entity, attribute) set scoped precisely: world-keyed canon by world
    // (only when a world is bound), else this book's own book-keyed canon.
    const canonRows = this.db.prepare(
      `SELECT DISTINCT entity, attribute FROM facts
       WHERE source = 'canon' AND ( (? IS NOT NULL AND world IS ?) OR book_slug = ? )`,
    ).all(scope.world, scope.world, scope.bookSlug);
    const canonKey = new Set(canonRows.map((r: any) => `${r.entity}\0${r.attribute}`));
    const byKey = new Map<string, { entity: string; attribute: string; chapters: Set<string> }>();
    for (const r of rows) {
      if (!r.chapter || r.chapter === 'CANON') continue;
      const key = `${r.entity}\0${r.attribute}`;
      let e = byKey.get(key);
      if (!e) { e = { entity: r.entity, attribute: r.attribute, chapters: new Set() }; byKey.set(key, e); }
      e.chapters.add(r.chapter);
    }
    return [...byKey.values()]
      // numeric-aware chapter order (chapter-2 before chapter-10, not lexical chapter-1, chapter-10, chapter-2)
      .map(e => ({ entity: e.entity, attribute: e.attribute, chapters: [...e.chapters].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), isCanon: canonKey.has(`${e.entity}\0${e.attribute}`) }))
      .filter(e => e.chapters.length > 0)
      .sort((a, b) => b.chapters.length - a.chapters.length || a.entity.localeCompare(b.entity) || a.attribute.localeCompare(b.attribute));
  }

  /**
   * Orphan canon facts (Worldfall "Chekhov's gun"): canon/bible facts whose
   * (entity, attribute) is never dramatized by any manuscript chapter — declared
   * worldbuilding that no scene uses (a cut candidate or a missing scene). Match
   * is alias-aware (canon "Rob Vane" vs manuscript "Rob") and attribute-exact.
   * Deterministic; no AI.
   */
  orphanCanonFacts(scope: { world: string | null; bookSlug: string }): Array<{ entity: string; attribute: string; valueRaw: string; world: string | null }> {
    if (!this.db) return [];
    const canon = this.db.prepare(
      `SELECT entity, attribute, value_raw, aliases, world FROM facts
       WHERE source = 'canon' AND ( (? IS NOT NULL AND world IS ?) OR book_slug = ? )
       ORDER BY id`,
    ).all(scope.world, scope.world, scope.bookSlug);
    const manuscript = this.db.prepare(
      `SELECT entity, attribute, aliases FROM facts
       WHERE book_slug = ? AND source = 'manuscript' AND canonical = 1`,
    ).all(scope.bookSlug);
    // Per-attribute set of lowercased manuscript names (entity + aliases).
    const namesByAttr = new Map<string, Set<string>>();
    for (const m of manuscript) {
      let set = namesByAttr.get(m.attribute);
      if (!set) { set = new Set(); namesByAttr.set(m.attribute, set); }
      set.add(String(m.entity).toLowerCase());
      try { for (const a of JSON.parse(m.aliases)) set.add(String(a).toLowerCase()); } catch { /* aliases optional */ }
    }
    const seen = new Set<string>();
    const out: Array<{ entity: string; attribute: string; valueRaw: string; world: string | null }> = [];
    for (const c of canon) {
      const key = `${c.entity}\0${c.attribute}`;
      if (seen.has(key)) continue;
      const names = new Set<string>([String(c.entity).toLowerCase()]);
      try { for (const a of JSON.parse(c.aliases)) names.add(String(a).toLowerCase()); } catch { /* aliases optional */ }
      const dramatized = namesByAttr.get(c.attribute);
      const used = !!dramatized && [...names].some(n => dramatized.has(n));
      if (!used) { seen.add(key); out.push({ entity: c.entity, attribute: c.attribute, valueRaw: c.value_raw, world: c.world }); }
    }
    return out.sort((a, b) => a.entity.localeCompare(b.entity) || a.attribute.localeCompare(b.attribute));
  }

  clearBookFacts(bookSlug: string): void { if (this.db) this.db.prepare('DELETE FROM facts WHERE book_slug = ?').run(bookSlug); }
  clearWorldCanon(world: string): void {
    if (!this.db) return;
    this.db.prepare("DELETE FROM facts WHERE world = ? AND source = 'canon'").run(world);
    this.db.prepare('DELETE FROM canon_seed WHERE world = ?').run(world);
  }
  insertKnowledge(events: KnowledgeEvent[]): void {
    if (!this.db || events.length === 0) return;
    const stmt = this.db.prepare(`INSERT INTO knowledge
      (world, book_slug, knower, fact_key, kind, source, story_time, chapter, scene, canonical, evidence)
      VALUES (@world,@bookSlug,@knower,@factKey,@kind,@source,@storyTime,@chapter,@scene,@canonical,@evidence)`);
    const tx = this.db.transaction((rows: KnowledgeEvent[]) => {
      for (const e of rows) stmt.run({ ...e, canonical: e.canonical ? 1 : 0 });
    });
    tx(events);
  }

  knowledgeForBook(scope: { world: string | null; bookSlug: string }): KnowledgeEvent[] {
    if (!this.db) return [];
    const rows = this.db.prepare('SELECT * FROM knowledge WHERE book_slug = ? ORDER BY story_time ASC, id ASC').all(scope.bookSlug);
    return rows.map((r: any) => ({
      world: r.world, bookSlug: r.book_slug, knower: r.knower, factKey: r.fact_key,
      kind: r.kind, source: r.source, storyTime: r.story_time, chapter: r.chapter,
      scene: r.scene, canonical: r.canonical !== 0, evidence: r.evidence,
    }));
  }

  clearBookKnowledge(bookSlug: string): void { if (this.db) this.db.prepare('DELETE FROM knowledge WHERE book_slug = ?').run(bookSlug); }

  canonSeedHash(world: string): string | null {
    if (!this.db) return null;
    const row = this.db.prepare('SELECT hash FROM canon_seed WHERE world = ?').get(world);
    return row ? row.hash : null;
  }
  setCanonSeed(world: string, hash: string): void {
    if (this.db) this.db.prepare('INSERT OR REPLACE INTO canon_seed (world, hash, seeded_at) VALUES (?,?,?)').run(world, hash, new Date().toISOString());
  }
  saveReport(bookSlug: string, report: unknown): void {
    if (this.db) this.db.prepare('INSERT OR REPLACE INTO audit_reports (book_slug, report, updated_at) VALUES (?,?,?)').run(bookSlug, JSON.stringify(report), new Date().toISOString());
  }
  getReport(bookSlug: string): unknown | null {
    if (!this.db) return null;
    const row = this.db.prepare('SELECT report FROM audit_reports WHERE book_slug = ?').get(bookSlug);
    return row ? JSON.parse(row.report) : null;
  }
}
