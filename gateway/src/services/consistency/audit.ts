import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { ConsistencyStore } from './fact-store.js';
import { evaluateFact, evaluateKnowledge, type Gap } from './check-engine.js';
import type { ExtractResult } from './extractor.js';
import type { ConsistencyFinding, LedgerFact, KnowledgeEvent } from './types.js';

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
  knowledgeEventCount: number;
  nonCanonicalSceneCount: number;
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

/** Non-prose heading labels to skip when splitting a combined manuscript. */
const MANUSCRIPT_NOISE = /\b(contents|table of contents|toc|copyright|dedication|acknowledg|about the author|also by|title page|epigraph|colophon)\b/i;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/**
 * A line that begins a chapter: a top-level ATX heading (`# …`), or a bare
 * "Chapter N" line (imported manuscripts don't always use `#` for every
 * chapter). Returns the cleaned heading text, or null. The bare form is gated
 * to "Chapter <number>" optionally followed by a separator + title, so a prose
 * sentence that merely starts with "Chapter N …" is NOT treated as a heading.
 */
function chapterHeading(line: string): string | null {
  const atx = line.match(/^#[ \t]+(.*\S)/);
  if (atx) return atx[1].replace(/\{[^}]*\}\s*$/, '').replace(/[*_`]/g, '').trim(); // strip pandoc attrs + emphasis
  const bare = line.replace(/\\+\s*$/, '').trim(); // drop a trailing markdown line-break backslash
  if (bare.length <= 60 && /^chapter\s+\d+\b\s*(?:[:.–—-]\s*.*)?$/i.test(bare)) {
    return bare.replace(/[*_`]/g, '').trim();
  }
  return null;
}

/**
 * Pick a combined single-file manuscript from a data dir's filenames — an IMPORTED
 * book keeps its whole text in one file (e.g. manuscript.md) instead of the
 * per-chapter files the generation pipeline produces. Prefers an exact
 * `manuscript.md`, else the first `.md` whose stem contains "manuscript".
 */
export function findCombinedManuscript(names: string[]): string | null {
  const md = names.filter(n => n.toLowerCase().endsWith('.md'));
  const exact = md.find(n => n.toLowerCase() === 'manuscript.md');
  if (exact) return exact;
  const cand = md.filter(n => /manuscript/.test(n.toLowerCase().replace(/\.md$/, ''))).sort();
  return cand[0] ?? null;
}

/**
 * Split a combined manuscript into chapter-sized segments by its top-level ATX
 * headings (`# …`). Front matter before the first heading is dropped; TOC /
 * copyright / etc. heading sections are skipped; lower-level headings (`## …`)
 * stay inside their chapter segment. Each segment is named from a slug of its
 * heading. Lets an imported single-file book scan like a generated one.
 */
export function splitManuscriptIntoChapters(text: string): { name: string; text: string }[] {
  const lines = text.split(/\r?\n/);
  const segments: { heading: string; body: string[] }[] = [];
  let cur: { heading: string; body: string[] } | null = null;
  for (const line of lines) {
    const heading = chapterHeading(line);
    if (heading !== null) {
      if (cur) segments.push(cur);
      cur = { heading, body: [line] };
    } else if (cur) {
      cur.body.push(line);
    }
    // lines before the first heading (title page / copyright) are dropped
  }
  if (cur) segments.push(cur);

  const out: { name: string; text: string }[] = [];
  const used = new Map<string, number>();
  for (const seg of segments) {
    if (MANUSCRIPT_NOISE.test(seg.heading) || CHAPTER_NOISE.test(seg.heading.toLowerCase())) continue;
    const body = seg.body.join('\n').trim();
    if (!body) continue;
    const base = slugify(seg.heading) || 'section';
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    out.push({ name: n > 1 ? `${base}-${n}` : base, text: body });
  }
  return out;
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


/** Read data/.non-canonical.json (chapterStem -> canonical boolean). Fail-soft -> {}. */
export function loadNonCanonicalOverride(dataDir: string): Record<string, boolean> {
  try {
    const p = join(dataDir, '.non-canonical.json');
    if (!existsSync(p)) return {};
    const raw = JSON.parse(readFileSync(p, 'utf-8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'boolean') out[k] = v;
    return out;
  } catch { return {}; }
}

/**
 * Resolve a scene/fact's effective canonical flag: an author chapter override
 * (when present) wins over the extractor's auto-detected value.
 */
function effectiveCanonical(chapterOverride: boolean | undefined, autoCanonical: boolean): boolean {
  return chapterOverride !== undefined ? chapterOverride : autoCanonical;
}

export async function runConsistencyAudit(slug: string, deps: AuditDeps): Promise<AuditReport> {
  const { store, books, extract, onProgress } = deps;
  const progress = (msg: string) => onProgress?.(msg);

  const dataDir = books.dataDirOf(slug);
  if (!dataDir || !existsSync(dataDir)) {
    return { findings: [], chaptersScanned: 0, factCount: 0, knowledgeEventCount: 0, nonCanonicalSceneCount: 0, generatedAt: new Date().toISOString() };
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

  // Idempotent rebuild: clear prior manuscript facts + knowledge for this book.
  store.clearBookFacts(slug);
  store.clearBookKnowledge(slug);

  // Author override: data/.non-canonical.json maps a chapter file stem to a
  // canonical boolean; it wins over the extractor's auto-detected scene flag.
  const override = loadNonCanonicalOverride(dataDir);
  const allKnowledge: KnowledgeEvent[] = [];
  let nonCanonicalSceneCount = 0;
  let knowledgeEventCount = 0;

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
            canonical: f.canonical !== false,
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
          canonical: f.canonical !== false,
        }));
        store.insertFacts(canonFacts);
        progress(`Book canon seeded: ${canonFacts.length} facts`);
      } catch (err) {
        progress(`Book canon seeding failed: ${(err as Error)?.message ?? err}`);
      }
    }
  }

  // --- Enumerate chapters (I1) ---
  // Per-chapter files (generation-pipeline output) are preferred. An IMPORTED book
  // keeps its whole manuscript in ONE file (e.g. manuscript.md) — when there are no
  // per-chapter files, split that combined manuscript into chapter segments by its
  // top-level headings so it scans like a generated book.
  let chapters: { name: string; text: string }[] = [];
  try {
    const all = readdirSync(dataDir);
    const chapterFiles = selectChapterFiles(all);
    if (chapterFiles.length > 0) {
      for (const f of chapterFiles) {
        try { chapters.push({ name: f.replace(/\.md$/, ''), text: readFileSync(join(dataDir, f), 'utf-8') }); }
        catch { progress(`Skipping ${f}: could not read file`); }
      }
    } else {
      const combined = findCombinedManuscript(all);
      if (combined) {
        try {
          chapters = splitManuscriptIntoChapters(readFileSync(join(dataDir, combined), 'utf-8'));
          progress(`No per-chapter files — split "${combined}" into ${chapters.length} chapter segment(s)`);
        } catch (err) {
          progress(`Could not read "${combined}": ${(err as Error)?.message ?? err}`);
        }
      }
    }
  } catch {
    return { findings: [], chaptersScanned: 0, factCount: 0, knowledgeEventCount: 0, nonCanonicalSceneCount: 0, generatedAt: new Date().toISOString() };
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

  for (const { name: chapterName, text: chapterText } of chapters) {
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

    // Effective per-scene canonical: author override (by chapter stem) wins over
    // the extractor's auto-detect. A non-canonical scene's facts are still stored
    // but excluded from the check (both as priors — via priorFacts — and as subjects).
    const chapterOverride = override[chapterName];

    // Evaluate each extracted fact against priors + earlier facts in THIS chapter (M1).
    const chapterFacts: LedgerFact[] = [];
    for (const f of extractResult.facts) {
      const isCanonical = effectiveCanonical(chapterOverride, f.canonical !== false);
      const full: LedgerFact = {
        ...f,
        world: worldName,
        bookSlug: slug,
        chapter: chapterName,
        canonical: isCanonical,
      };
      if (isCanonical) {
        // Combine ledger priors with already-collected intra-chapter facts for the same
        // entity+attribute. Only IMMUTABLE intra-chapter facts are cross-checked: a
        // character's eye colour stated two ways in one chapter is a real contradiction,
        // but STATEFUL details (clothing, location, hair) legitimately progress within a
        // scene — comparing two same-scene observations would flag normal change as an
        // impossibility. Stateful facts are still checked across chapters via the ledger.
        const ledgerPriors = store.priorFacts(scope, full.entity, full.attribute);
        const intraChapterPriors = chapterFacts.filter(
          c => c.entity === full.entity && c.attribute === full.attribute && c.type === 'immutable' && c.canonical,
        );
        const priors = [...intraChapterPriors, ...ledgerPriors];
        const finding = evaluateFact(full, priors, gap);
        if (finding) findings.push(finding);
        // Update in-memory entity state for the digest (M3) from canonical facts only.
        if (!entityAliases.has(full.entity)) entityAliases.set(full.entity, new Set());
        for (const alias of full.aliases) entityAliases.get(full.entity)!.add(alias);
        if (full.type === 'stateful') {
          entityCurrentState.set(`${full.entity}\0${full.attribute}`, full.valueNorm);
        }
      }
      chapterFacts.push(full);
    }

    // Collect this chapter's knowledge events with the effective canonical applied.
    for (const k of (extractResult.knowledge ?? [])) {
      const isCanonical = effectiveCanonical(chapterOverride, k.canonical !== false);
      allKnowledge.push({ ...k, world: worldName, bookSlug: slug, chapter: chapterName, canonical: isCanonical });
    }
    knowledgeEventCount += (extractResult.knowledge ?? []).length;
    nonCanonicalSceneCount += (extractResult.scenes ?? []).filter(s =>
      !effectiveCanonical(chapterOverride, s.canonical !== false)).length;

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

  // Knowledge Matrix: second deterministic pass over all collected events, once
  // every chapter's facts + canonical flags are final.
  if (allKnowledge.length > 0) {
    try { store.insertKnowledge(allKnowledge); } catch (err) { progress(`Warning: failed to persist knowledge: ${(err as Error)?.message ?? err}`); }
    for (const kf of evaluateKnowledge(allKnowledge)) findings.push(kf);
  }

  const report: AuditReport = {
    findings,
    chaptersScanned,
    factCount,
    knowledgeEventCount,
    nonCanonicalSceneCount,
    generatedAt: new Date().toISOString(),
  };
  store.saveReport(slug, report);
  progress(`Audit complete: ${chaptersScanned} chapters, ${factCount} facts, ${findings.length} findings`);
  return report;
}
