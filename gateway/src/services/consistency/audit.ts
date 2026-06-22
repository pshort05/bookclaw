import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ConsistencyStore } from './fact-store.js';
import { evaluateFact, type Gap } from './check-engine.js';
import type { ExtractResult } from './extractor.js';
import type { ConsistencyFinding, LedgerFact } from './types.js';

export interface AuditDeps {
  store: ConsistencyStore;
  books: {
    dataDirOf(s: string): string | null;
    worldDocsOf(s: string): string | null;
    worldbuildingOf(s: string): string | null;
    open(s: string): Promise<any>;
  };
  extract: (chapterText: string, known: any[], base: number) => Promise<ExtractResult>;
  onProgress?: (msg: string) => void;
}

export interface AuditReport {
  findings: ConsistencyFinding[];
  chaptersScanned: number;
  factCount: number;
  generatedAt: string;
}

// Noise labels that disqualify a file from being treated as chapter prose.
const CHAPTER_NOISE = /outline|summary|brief|guide|consistency|audit|council|bible|notes|premise|dossier|plan|beta|critique|structure/;

// Stage rank for choosing the best version when multiple files cover the same chapter.
function stageRank(name: string): number {
  if (/polish/.test(name)) return 3;
  if (/revise/.test(name)) return 2;
  if (/write|draft/.test(name)) return 1;
  return 0;
}

/**
 * Select chapter-prose files from a set of data-dir filenames.
 * Keeps only files whose lowercased stem matches /chapter-(\d+)\b/,
 * excluding noise labels. For each chapter number, keeps the highest-ranked
 * stage (polish > revise > write/draft > bare). Returns sorted ascending by
 * chapter number.
 */
export function selectChapterFiles(names: string[]): string[] {
  const best = new Map<number, { name: string; rank: number }>();
  for (const name of names) {
    const stem = name.toLowerCase().replace(/\.md$/, '');
    const m = stem.match(/chapter-(\d+)\b/);
    if (!m) continue;
    if (CHAPTER_NOISE.test(stem)) continue;
    const num = parseInt(m[1], 10);
    const rank = stageRank(stem);
    const prev = best.get(num);
    if (!prev || rank > prev.rank) {
      best.set(num, { name, rank });
    }
  }
  return [...best.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, v]) => v.name);
}

/**
 * Infer a story-clock Gap from two consecutive scene timeLabels.
 * Deterministic — no LLM.
 * Order matters: test multi-unit spans (longer) before same-day markers (day).
 */
export function inferGap(prev: string | null, curr: string | null): Gap {
  if (!curr) return 'unknown';
  const lc = curr.toLowerCase();
  // Longer: multi-unit elapsed spans must be tested first to avoid
  // "days later" being caught by the "day" branch below.
  if (/\b(?:days?|weeks?|months?|years?)\s+later\b/.test(lc)) return 'longer';
  if (/\b(?:week|month|year)s?\b/.test(lc)) return 'longer';
  // Same scene: short spans and simultaneous markers (test before 'day' — "that evening" is same-scene).
  if (/moment|second|minute|immediately|still|same|meanwhile|that evening/.test(lc)) return 'same';
  // Same day: next-day or same-day transitions.
  if (/day|morning|afternoon|night|tonight|later that|next|tomorrow/.test(lc)) return 'day';
  return 'unknown';
}


export async function runConsistencyAudit(slug: string, deps: AuditDeps): Promise<AuditReport> {
  const { store, books, extract, onProgress } = deps;
  const progress = (msg: string) => onProgress?.(msg);

  const dataDir = books.dataDirOf(slug);
  if (!dataDir || !existsSync(dataDir)) {
    return { findings: [], chaptersScanned: 0, factCount: 0, generatedAt: new Date().toISOString() };
  }

  // Resolve the world name from the book manifest (used for canon scoping).
  let worldName: string | null = null;
  try {
    const opened = await books.open(slug);
    worldName = opened?.manifest?.pulledFrom?.world?.name ?? null;
  } catch {
    // fail-soft
  }
  const scope = { world: worldName, bookSlug: slug };

  // Idempotent rebuild: clear prior manuscript facts for this book.
  store.clearBookFacts(slug);

  // --- Canon seeding (C1 + I3) ---
  // worldbuildingOf / worldDocsOf return composed markdown STRINGS, not paths.
  // Use them directly; do not existsSync/readFileSync on them.
  const wbText = books.worldbuildingOf(slug) ?? '';
  const wdText = books.worldDocsOf(slug) ?? '';
  const canonText = [wbText, wdText].filter(Boolean).join('\n\n');

  if (canonText) {
    const hash = createHash('sha256').update(canonText).digest('hex').slice(0, 16);

    if (worldName) {
      // World-keyed canon: shared across all books bound to this world.
      const seedKey = worldName;
      if (store.canonSeedHash(seedKey) !== hash) {
        store.clearWorldCanon(worldName);
        try {
          progress(`Seeding canon from world "${worldName}"...`);
          const canonResult = await extract(canonText, [], 0);
          const label = `World: ${worldName}`;
          const canonFacts: LedgerFact[] = canonResult.facts.map(f => ({
            ...f,
            world: worldName!,
            bookSlug: null,
            chapter: 'CANON',
            source: 'canon',
            sourceLabel: label,
          }));
          store.insertFacts(canonFacts);
          store.setCanonSeed(seedKey, hash);
          progress(`Canon seeded: ${canonFacts.length} facts`);
        } catch (err) {
          progress(`Canon seeding failed: ${(err as Error)?.message ?? err}`);
        }
      } else {
        progress(`Canon unchanged (hash match), skipping re-seed`);
      }
    } else {
      // Book-keyed canon: no world bound; scope to this book's slug.
      // clearBookFacts above already wiped these rows, so always re-seed.
      // The extract cost is one mid-tier call — acceptable for an audit.
      try {
        progress(`Seeding book-keyed canon for "${slug}"...`);
        const canonResult = await extract(canonText, [], 0);
        const canonFacts: LedgerFact[] = canonResult.facts.map(f => ({
          ...f,
          world: null,
          bookSlug: slug,
          chapter: 'CANON',
          source: 'canon',
          sourceLabel: 'Series bible',
        }));
        store.insertFacts(canonFacts);
        progress(`Book canon seeded: ${canonFacts.length} facts`);
      } catch (err) {
        progress(`Book canon seeding failed: ${(err as Error)?.message ?? err}`);
      }
    }
  }

  // --- Enumerate chapters (I1) ---
  let chapterFiles: string[];
  try {
    const all = readdirSync(dataDir);
    chapterFiles = selectChapterFiles(all);
  } catch {
    return { findings: [], chaptersScanned: 0, factCount: 0, generatedAt: new Date().toISOString() };
  }

  const findings: ConsistencyFinding[] = [];
  let storyBase = 0;
  let factCount = 0;
  let chaptersScanned = 0;
  // Track the last scene's timeLabel for gap inference.
  let prevTimeLabel: string | null = null;
  // M3: in-memory latest stateful value per entity+attribute, updated as chapters are processed.
  // Key: `${entity}\0${attribute}`, value: current valueNorm.
  const entityCurrentState = new Map<string, string>();
  // Track all known aliases per entity (canonical name → set of seen aliases).
  const entityAliases = new Map<string, Set<string>>();

  for (const filename of chapterFiles) {
    const chapterName = filename.replace(/\.md$/, '');
    const chapterPath = join(dataDir, filename);
    let chapterText: string;
    try {
      chapterText = readFileSync(chapterPath, 'utf-8');
    } catch {
      progress(`Skipping ${filename}: could not read file`);
      continue;
    }

    progress(`Scanning ${chapterName}...`);

    // Build known-entity digest with current stateful values from the in-memory map (M3).
    const knownDigest: { entity: string; aliases: string[]; current: Record<string, string> }[] =
      Array.from(entityAliases.keys()).map(e => {
        const current: Record<string, string> = {};
        for (const [key, val] of entityCurrentState) {
          const sep = key.indexOf('\0');
          if (sep !== -1 && key.slice(0, sep) === e) {
            current[key.slice(sep + 1)] = val;
          }
        }
        return { entity: e, aliases: Array.from(entityAliases.get(e) ?? [e]), current };
      });

    let extractResult: ExtractResult;
    try {
      extractResult = await extract(chapterText, knownDigest, storyBase);
    } catch (err) {
      // I4: emit a distinct diagnosable message rather than silently swallowing.
      progress(`⚠ chapter ${chapterName}: extraction failed (${(err as Error)?.message ?? err}) — 0 facts`);
      continue;
    }

    // Infer gap from the first scene's timeLabel vs the previous chapter's last scene.
    const firstSceneLabel = extractResult.scenes[0]?.timeLabel ?? null;
    const gap: Gap = inferGap(prevTimeLabel, firstSceneLabel);
    // Update prevTimeLabel to the last scene of this chapter.
    const lastScene = extractResult.scenes[extractResult.scenes.length - 1];
    prevTimeLabel = lastScene?.timeLabel ?? null;

    // Evaluate each extracted fact against priors + earlier facts in THIS chapter (M1).
    const chapterFacts: LedgerFact[] = [];
    for (const f of extractResult.facts) {
      const full: LedgerFact = {
        ...f,
        world: worldName,
        bookSlug: slug,
        chapter: chapterName,
      };
      // Combine ledger priors with already-collected intra-chapter facts for the same
      // entity+attribute. Only IMMUTABLE intra-chapter facts are cross-checked: a
      // character's eye colour stated two ways in one chapter is a real contradiction,
      // but STATEFUL details (clothing, location, hair) legitimately progress within a
      // scene — comparing two same-scene observations would flag normal change as an
      // impossibility. Stateful facts are still checked across chapters via the ledger.
      const ledgerPriors = store.priorFacts(scope, full.entity, full.attribute);
      const intraChapterPriors = chapterFacts.filter(
        c => c.entity === full.entity && c.attribute === full.attribute && c.type === 'immutable',
      );
      const priors = [...intraChapterPriors, ...ledgerPriors];
      const finding = evaluateFact(full, priors, gap);
      if (finding) findings.push(finding);
      chapterFacts.push(full);
      // Update in-memory entity state for the digest (M3).
      if (!entityAliases.has(full.entity)) entityAliases.set(full.entity, new Set());
      for (const alias of full.aliases) entityAliases.get(full.entity)!.add(alias);
      if (full.type === 'stateful') {
        entityCurrentState.set(`${full.entity}\0${full.attribute}`, full.valueNorm);
      }
    }

    // Persist this chapter's facts so subsequent chapters see them as priors.
    try {
      store.insertFacts(chapterFacts);
    } catch (err) {
      progress(`Warning: failed to persist facts for ${chapterName}: ${(err as Error)?.message ?? err}`);
    }

    factCount += chapterFacts.length;
    storyBase += extractResult.scenes.length || 1;
    chaptersScanned++;
  }

  const report: AuditReport = {
    findings,
    chaptersScanned,
    factCount,
    generatedAt: new Date().toISOString(),
  };
  store.saveReport(slug, report);
  progress(`Audit complete: ${chaptersScanned} chapters, ${factCount} facts, ${findings.length} findings`);
  return report;
}
