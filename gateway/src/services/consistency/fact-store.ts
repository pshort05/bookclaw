import { join, dirname } from 'path';
import type { LedgerFact } from './types.js';

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
          source TEXT NOT NULL, evidence TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_facts_lookup ON facts (world, book_slug, entity, attribute);
        CREATE INDEX IF NOT EXISTS idx_facts_book ON facts (book_slug, chapter);
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
      (world, book_slug, entity, aliases, attribute, type, value_raw, value_norm, story_time, time_label, transition, chapter, scene, source, evidence)
      VALUES (@world,@bookSlug,@entity,@aliases,@attribute,@type,@valueRaw,@valueNorm,@storyTime,@timeLabel,@transition,@chapter,@scene,@source,@evidence)`);
    const tx = this.db.transaction((rows: LedgerFact[]) => {
      for (const f of rows) stmt.run({ ...f, aliases: JSON.stringify(f.aliases) });
    });
    tx(facts);
  }

  priorFacts(scope: { world: string | null; bookSlug: string }, entity: string, attribute: string): LedgerFact[] {
    if (!this.db) return [];
    const rows = this.db.prepare(`SELECT * FROM facts
      WHERE entity = ? AND attribute = ?
        AND ( book_slug = ? OR (source = 'canon' AND world IS ? ) )
      ORDER BY story_time DESC, id DESC`).all(entity, attribute, scope.bookSlug, scope.world);
    return rows.map((r: any) => ({
      world: r.world, bookSlug: r.book_slug, entity: r.entity, aliases: JSON.parse(r.aliases),
      attribute: r.attribute, type: r.type, valueRaw: r.value_raw, valueNorm: r.value_norm,
      storyTime: r.story_time, timeLabel: r.time_label, transition: r.transition,
      chapter: r.chapter, scene: r.scene, source: r.source, evidence: r.evidence,
    }));
  }

  clearBookFacts(bookSlug: string): void { if (this.db) this.db.prepare('DELETE FROM facts WHERE book_slug = ?').run(bookSlug); }
  clearWorldCanon(world: string): void {
    if (!this.db) return;
    this.db.prepare("DELETE FROM facts WHERE world = ? AND source = 'canon'").run(world);
    this.db.prepare('DELETE FROM canon_seed WHERE world = ?').run(world);
  }
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
