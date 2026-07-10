/**
 * Types + constants for the book entity (book-container Phase 2).
 *
 * A book is a self-contained directory: book.json manifest + templates/ snapshot
 * + data/ outputs. schemaVersion gates compatibility (fail-closed per book).
 */

/** Bump ONLY when book.json / the container layout changes in a breaking way. */
export const BOOK_SCHEMA_VERSION = 2;
/** Oldest book schema this app can open without migration. */
export const BOOK_MIN_SUPPORTED = 1;

import type { Cadence } from './pipeline/gate-cadence.js';

/** Gate outcome for a book on open. */
export type BookStatus = 'ok' | 'readonly' | 'quarantined';

/** Provenance for one snapshotted component. */
export interface PulledRef {
  name: string;
  source: 'builtin' | 'workspace' | 'synthetic';
  version?: number; // pipelines carry one; prose templates don't
}

/**
 * Declared structure × form × pacing for a book (Book Format & Structure feature).
 * `customStructure` is a full StoryStructure when `structureId === 'custom'`; typed
 * opaquely here to avoid a service→types import cycle.
 */
export interface BookFormat {
  structureId: string;             // story-structures id or 'custom'
  customStructure?: unknown;       // StoryStructure shape when structureId === 'custom'
  formId: string;                  // story-forms id
  chapterCount: number;
  wordsPerChapter: number;
  totalTarget: number;             // chapterCount * wordsPerChapter
}

export interface BookManifest {
  id: string;                 // stable id (= slug at creation)
  slug: string;               // dir name under workspace/books/
  title: string;
  schemaVersion: number;      // THE compatibility gate
  createdByApp: string;       // provenance only — never gates
  lastWrittenByApp: string;   // provenance only
  phase: string;              // current pipeline phase (advanced by ProjectEngine.onStepCompleted, TODO #15); 'planning' at creation
  pipelineSequence?: string[]; // v2: ordered pipeline names the book runs (source of truth); each snapshotted to templates/pipeline/<name>.json

  createdAt: string;          // ISO
  pulledFrom: {
    author: PulledRef;
    voice?: PulledRef;
    genre?: PulledRef | null;
    pipeline: PulledRef;
    sections: string[];       // section names snapshotted
    skills?: string[];        // pipeline-referenced skill names snapshotted (frozen record)
    series?: { id: string; title: string };  // Series Phase A — set when created in a series
    world?: PulledRef | null; // World Repository Phase 3 — the bound world, null when unbound
  };
  worldDocs?: string[];       // World Repository Phase 3 — curated doc ids = the bible (additive-optional, no schema bump)
  appendix?: Array<{ docId: string; title?: string; order: number }>; // World Repository Phase 5 — ordered back-matter selection (additive-optional, no schema bump)
  format?: BookFormat;        // Book Format & Structure — declared structure × form × pacing (additive-optional, no schema bump)
  consistency?: { provider?: string; model?: string }; // Consistency audit model selection (additive-optional, no schema bump)
  preferredProvider?: string; // Default AI provider for this book's generation; inherited by projects created against it (additive-optional, no schema bump)
  preferredModel?: string; // Default model id for the chosen provider (e.g. an OpenRouter slug); inherited by projects (additive-optional, no schema bump)
  contentCeiling?: { spice: number; violence: number }; // Author-branded content axes (0-10) driving the heat_check intimacy branch; absent = fade-to-black, untouched by Plan 2 routing (additive-optional, no schema bump)
  costBudget?: number; // Flagship Plan 6, Task 3 — per-book spend cap in dollars; wired into CostTracker.setBookBudget at create time and on boot; absent = unbounded (additive-optional, no schema bump)
  uncensoredProvider?: 'grok' | 'venice' | 'auto'; // Preferred provider for a spice-flagged scene re-route; 'auto' defers to the casting sheet's heatLadder (additive-optional, no schema bump)
  grounding?: { enabled?: boolean }; // Flagship Plan 4 — front-of-pipeline grounding research toggle; absent/true = on (additive-optional, no schema bump)
  review?: { cadence?: Cadence }; // Flagship Plan 5 — human-review gate cadence; absent = 'per_act' default (additive-optional, no schema bump)
  ensemble?: { enabled?: boolean; panel?: string[] }; // Flagship Plan 8 — opt-in multi-model ideation ensemble on the premise phase; absent/enabled!==true = off (most expensive front-end, additive-optional, no schema bump)
  seeds?: { storyArc?: string; characters?: string; setting?: string; blueprint?: string; councilSelection?: 'auto' | 'propose' }; // Romance Workflow Foundation — author-provided seeds developed by the pipeline's front half; blueprint (act/POV/ending scaffold) honored by the outline step; councilSelection reserved for sub-project 2 (inert here) (additive-optional, no schema bump)
  history: Array<{ at: string; event: string; detail?: string }>;
}

/** A book + its computed gate status (status is not stored in book.json). */
export interface BookSummary {
  slug: string;
  title: string;
  phase: string;
  schemaVersion: number;
  status: BookStatus;
  createdAt: string;
  // byline (book-container Phase 6c) — names only, from the manifest's pulledFrom snapshot
  author?: string;
  voice?: string;
  genre?: string | null;
  pipeline?: string;
  series?: string;          // series title (Series Phase C) — for the board card byline
}

/**
 * Classify a stored schemaVersion against this app's supported range.
 *
 * Enforcement (book-container Phase 3 → tightened 2026-06-12): the gate is now
 * ENFORCED on per-book TEMPLATE writes — BookService.writeTemplate and .repull
 * throw via assertWritable when status is not `ok`, so a quarantined/readonly
 * book is never rewritten in an incompatible app's shape. Enforcement at the
 * engine's data-output path (BookService.dataDirOf) remains DEFERRED (it's
 * cross-cutting; see the note there). As of the 2026-06-14 v1→v2 bump,
 * BOOK_SCHEMA_VERSION === 2 with BOOK_MIN_SUPPORTED === 1, so v1 and v2 books
 * both classify `ok` (v1 is lazily migrated on open); a `readonly` book — one
 * written by a newer app (schemaVersion > 2) — is now reachable, and the
 * template-write throws fire for it.
 */
export function classifyVersion(v: number): BookStatus {
  if (v < BOOK_MIN_SUPPORTED) return 'quarantined'; // too old for this app
  if (v > BOOK_SCHEMA_VERSION) return 'readonly';    // written by a newer app
  return 'ok';
}

/** Snapshot kinds that DRIVE generation (author+voice via SoulService, pipeline via the engine, genre/world/sections via the prompt composer, skill content via snapshot-preference). */
export const WIRED_KINDS: ReadonlySet<string> = new Set(['author', 'voice', 'pipeline', 'worldbuilding', 'section', 'skill', 'world']);

/** A single .md filename (no path separators) allowed inside a multi-file template entry. */
export const MD_FILE_RE = /^[A-Za-z0-9._-]+\.md$/;

/** A filesystem-safe slug / entry name: lowercase alnum + hyphen, leading alnum. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Parse + shape-validate a pipeline JSON string. Throws on invalid. Returns the parsed object. */
export function parsePipelineJson(raw: string): { steps: unknown[]; schemaVersion: number; [k: string]: unknown } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('pipeline content must be valid JSON'); }
  const p = parsed as { steps?: unknown; schemaVersion?: unknown };
  if (!Array.isArray(p.steps) || typeof p.schemaVersion !== 'number') {
    throw new Error('pipeline JSON must have a steps array and a numeric schemaVersion');
  }
  return parsed as { steps: unknown[]; schemaVersion: number; [k: string]: unknown };
}

/** Suggested next action for a book, derived from phase + hasOutput. */
export interface NextStep {
  phase: string;
  hasOutput: boolean;
  label: string;
  hint: string;
}

export function suggestedNextStep(phase: string, hasOutput: boolean): { label: string; hint: string } {
  switch (phase) {
    case 'planning':   return { label: 'Plan the book',          hint: hasOutput ? 'Refine the premise and plan.' : 'Define the premise and high-level plan.' };
    case 'bible':      return { label: 'Build the story bible',  hint: 'Develop characters, world, and outline.' };
    case 'production': return { label: hasOutput ? 'Continue drafting' : 'Start drafting', hint: hasOutput ? 'Write the next chapters.' : 'Begin writing chapter one.' };
    case 'revision':   return { label: 'Revise the manuscript',  hint: 'Edit for craft, consistency, and pace.' };
    case 'format':     return { label: 'Format & compile',       hint: 'Produce the formatted manuscript and exports.' };
    case 'launch':     return { label: 'Launch',                 hint: 'Prepare marketing and publish.' };
    default:           return { label: 'Open the book',          hint: 'Review the current state.' };
  }
}

/**
 * Pipeline phase-project type → the book lifecycle phase it represents (the
 * board/Write vocabulary used by suggestedNextStep). createPipeline() chains
 * these six project types in order; each one IS a book phase.
 */
export const PROJECT_TYPE_PHASE: Record<string, string> = {
  'book-planning': 'planning',
  'book-bible': 'bible',
  'book-production': 'production',
  'deep-revision': 'revision',
  'format-export': 'format',
  'book-launch': 'launch',
};

/** Ordered book lifecycle phases (the board segments / suggestedNextStep keys). */
export const BOOK_PHASE_ORDER = ['planning', 'bible', 'production', 'revision', 'format', 'launch'] as const;

/**
 * The lifecycle phase a bound book should advance to when a pipeline
 * phase-project of the given type COMPLETES — i.e. the NEXT segment, so the
 * board shows the finished phase as done and the next as current, and the Write
 * view offers the next phase's action instead of re-suggesting the first
 * planning step. Clamps at 'launch' when the final project completes. Returns
 * null for non-pipeline project types (custom / novel-pipeline / unknown) so the
 * completion hook no-ops rather than clobbering an unrelated book's phase.
 */
export function nextBookPhaseAfter(projectType: string | undefined): string | null {
  if (!projectType) return null;
  const cur = PROJECT_TYPE_PHASE[projectType];
  if (!cur) return null;
  const i = BOOK_PHASE_ORDER.indexOf(cur as (typeof BOOK_PHASE_ORDER)[number]);
  if (i < 0) return null;
  return BOOK_PHASE_ORDER[Math.min(i + 1, BOOK_PHASE_ORDER.length - 1)];
}

/**
 * The pipeline in `sequence` whose lifecycle phase matches `phase` — e.g. phase
 * 'bible' → 'book-bible'. Lets the Write view show the book's CURRENT phase
 * pipeline (its plan/steps) instead of always the first/completed one. Returns
 * null when no entry matches (caller falls back to the first sequence entry).
 */
export function pipelineNameForPhase(phase: string | undefined, sequence: string[]): string | null {
  if (!phase) return null;
  for (const name of sequence) {
    if (PROJECT_TYPE_PHASE[name] === phase) return name;
  }
  return null;
}

/** Derive a filesystem-safe slug from a title. Never returns ''. */
export function slugify(title: string): string {
  const base = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base || 'book';
}
